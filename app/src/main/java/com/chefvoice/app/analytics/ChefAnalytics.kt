package com.chefvoice.app.analytics

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import com.google.firebase.FirebaseApp
import com.google.firebase.analytics.FirebaseAnalytics

/**
 * Product analytics for the activation funnel and the Pro paywall.
 *
 * Instrumented ahead of Play Billing on purpose. Once a paywall is live, a conversion
 * rate is only meaningful against a baseline, and there is no way to reconstruct a
 * baseline after the fact -- the first month of paywall data would be uninterpretable.
 * So the events land first and billing wires into them later.
 *
 * Three rules this object holds to:
 *
 * 1. It never throws and never blocks. Every call is wrapped and every failure is
 *    swallowed. The rule that entitlement checks must not stop someone cooking applies
 *    to telemetry with more force, not less.
 * 2. It is a no-op when Firebase is absent. `app/build.gradle.kts` applies the
 *    google-services plugin only when `google-services.json` exists, so a checkout
 *    without it must still build and run. Guarded through `FirebaseApp.getApps`, the
 *    same way `FirebaseSocialRepository` guards itself.
 * 3. No personal or recipe content leaves the device. Parameters are enums, booleans
 *    and counters only -- never a recipe title, transcript, ingredient, display name,
 *    email or uid. The recorded cooking audio and the transcript derived from it
 *    belong to the chef, and nothing drawn from them belongs in an analytics event.
 *
 * `install` is deliberately not emitted. Firebase Analytics logs `first_open`
 * automatically on the first launch after an install, carrying campaign attribution
 * that a hand-rolled event cannot reproduce; a second custom event beside it would
 * double-count installs in every funnel built on it. Use `first_open`.
 */
object ChefAnalytics {

    // ---- Activation funnel ---------------------------------------------------
    // Each of these fires at most once per install. first_recipe_completed is the
    // activation metric: the point at which a chef has actually got a recipe out of
    // the app, and the number every acquisition decision is measured against.

    const val FIRST_RECIPE_STARTED = "first_recipe_started"
    const val FIRST_RECIPE_COMPLETED = "first_recipe_completed"
    const val SECOND_RECIPE_COMPLETED = "second_recipe_completed"

    // ---- Second Pass ---------------------------------------------------------
    // The paywall's primary trigger sits here, so these two bracket it.

    const val SECOND_PASS_OPENED = "second_pass_opened"
    const val SECOND_PASS_ACCEPTED = "second_pass_accepted"

    // ---- Paywall -------------------------------------------------------------

    const val PAYWALL_SHOWN = "paywall_shown"
    const val PAYWALL_DISMISSED = "paywall_dismissed"

    // ---- Billing -------------------------------------------------------------
    // Declared but not yet emitted: there is no Play Billing integration in the app
    // and no billing Functions codebase. These are the names that work should call,
    // fixed now so the event vocabulary does not drift when it lands.

    const val CHECKOUT_STARTED = "checkout_started"
    const val PURCHASE_COMPLETED = "purchase_completed"
    const val SUBSCRIPTION_CANCELLED = "subscription_cancelled"
    const val BILLING_FAILURE = "billing_failure"

    // ---- Parameters ----------------------------------------------------------

    /** Which surface raised a paywall. One of the PaywallTrigger values. */
    const val PARAM_TRIGGER = "trigger"

    /** Which half of a Second Pass review a suggestion was accepted from. */
    const val PARAM_KIND = "kind"

    /** Play product id. Never a purchase token -- that is payment data. */
    const val PARAM_PRODUCT_ID = "product_id"

    /** Coarse failure category, never a raw exception message. */
    const val PARAM_REASON = "reason"

    const val KIND_INGREDIENT = "ingredient"
    const val KIND_METHOD = "method"

    private const val PREFS = "chefvoice_analytics"
    private const val KEY_MILESTONE_PREFIX = "milestone_"
    private const val KEY_RECIPES_COMPLETED = "recipes_completed"

    private var analytics: FirebaseAnalytics? = null
    private var prefs: SharedPreferences? = null

    /**
     * Called once from [com.chefvoice.app.ChefVoiceApplication]. Safe to call again;
     * safe to never call, in which case every event below is a no-op.
     */
    fun initialize(context: Context) {
        val app = context.applicationContext
        prefs = runCatching { app.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }.getOrNull()
        analytics = runCatching {
            if (FirebaseApp.getApps(app).isEmpty()) null else FirebaseAnalytics.getInstance(app)
        }.getOrNull()
    }

    // ---- Emitters ------------------------------------------------------------

    /**
     * A cooking capture actually started -- the microphone is open, not merely that the
     * button was tapped. Only the first one per install is recorded; the question worth
     * answering is how many people ever get as far as narrating once.
     */
    fun recipeCaptureStarted() = logMilestoneOnce(FIRST_RECIPE_STARTED)

    /**
     * A new recipe was saved to the library. Counted rather than flagged, so the first
     * and second completions cannot fire twice or out of order however the caller
     * behaves. Edits to an existing recipe are not completions and must not call this.
     */
    fun recipeCompleted() {
        val store = prefs ?: return
        val completed = runCatching {
            val next = store.getInt(KEY_RECIPES_COMPLETED, 0) + 1
            store.edit().putInt(KEY_RECIPES_COMPLETED, next).apply()
            next
        }.getOrNull() ?: return
        when (completed) {
            1 -> log(FIRST_RECIPE_COMPLETED)
            2 -> log(SECOND_RECIPE_COMPLETED)
        }
    }

    /** A Second Pass review was started against the original audio. */
    fun secondPassOpened() = log(SECOND_PASS_OPENED)

    /**
     * The chef took one of the suggestions Second Pass offered. Fires per accepted
     * suggestion rather than per review, so it measures how much of a diff is useful.
     */
    fun secondPassAccepted(kind: String) = log(SECOND_PASS_ACCEPTED, bundleOf(PARAM_KIND, kind))

    fun paywallShown(trigger: String) = log(PAYWALL_SHOWN, bundleOf(PARAM_TRIGGER, trigger))

    fun paywallDismissed(trigger: String) = log(PAYWALL_DISMISSED, bundleOf(PARAM_TRIGGER, trigger))

    fun checkoutStarted(productId: String) =
        log(CHECKOUT_STARTED, bundleOf(PARAM_PRODUCT_ID, productId))

    fun purchaseCompleted(productId: String) =
        log(PURCHASE_COMPLETED, bundleOf(PARAM_PRODUCT_ID, productId))

    fun subscriptionCancelled(productId: String) =
        log(SUBSCRIPTION_CANCELLED, bundleOf(PARAM_PRODUCT_ID, productId))

    fun billingFailure(reason: String) = log(BILLING_FAILURE, bundleOf(PARAM_REASON, reason))

    // ---- Plumbing ------------------------------------------------------------

    private fun bundleOf(key: String, value: String): Bundle =
        Bundle().apply { putString(key, value) }

    private fun log(name: String, params: Bundle? = null) {
        val client = analytics ?: return
        runCatching { client.logEvent(name, params) }
    }

    /**
     * Fires an event the first time it is ever requested on this install and never
     * again. If the preference store is unavailable the event is dropped rather than
     * logged unguarded -- a once-only metric that silently becomes a per-launch metric
     * is worse than a missing one.
     */
    private fun logMilestoneOnce(name: String, params: Bundle? = null) {
        val store = prefs ?: return
        val key = KEY_MILESTONE_PREFIX + name
        val alreadyFired = runCatching { store.getBoolean(key, false) }.getOrNull() ?: return
        if (alreadyFired) return
        runCatching { store.edit().putBoolean(key, true).apply() }
        log(name, params)
    }
}
