package com.chefvoice.app.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.google.firebase.functions.FirebaseFunctions

private const val TAG = "PlayBillingManager"

/** A specific thing that can be bought: a subscription base plan, or the lifetime product. */
sealed class ChefVoiceOffer(val productDetails: ProductDetails, val formattedPrice: String) {
    class Subscription(productDetails: ProductDetails, val offerToken: String, formattedPrice: String) :
        ChefVoiceOffer(productDetails, formattedPrice)
    class Lifetime(productDetails: ProductDetails, formattedPrice: String) :
        ChefVoiceOffer(productDetails, formattedPrice)
}

/**
 * ChefVoice Pro purchases via Google Play Billing (Library 9). This class only ever
 * talks to Play and to the `verifyChefVoicePurchase` callable; it never grants Pro
 * itself. The real entitlement stays `ChefAppState.proEntitlement`, mirrored from
 * Firestore and written only by the backend once that callable verifies a purchase
 * -- the same "server decides, client never grants itself anything" rule the launch
 * -access promo already follows. Every purchase, whether just made or restored on a
 * later launch, goes through the same verify-then-acknowledge path below, so there
 * is exactly one place that decides a purchase is real.
 */
class PlayBillingManager(context: Context) {
    private val appContext = context.applicationContext
    private var connected = false
    private val pendingOnConnected = mutableListOf<() -> Unit>()

    private val purchasesUpdatedListener = PurchasesUpdatedListener { result, purchases ->
        if (result.responseCode == BillingClient.BillingResponseCode.OK) {
            purchases?.forEach { verifyAndAcknowledge(it) }
        }
        // USER_CANCELED and every other response code: nothing to grant and nothing
        // worth interrupting the chef over -- the paywall is still right there.
    }

    private val billingClient = BillingClient.newBuilder(appContext)
        .setListener(purchasesUpdatedListener)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    private fun ensureConnected(onReady: () -> Unit) {
        if (connected) return onReady()
        pendingOnConnected += onReady
        if (pendingOnConnected.size > 1) return // A connection attempt is already in flight.
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                connected = result.responseCode == BillingClient.BillingResponseCode.OK
                if (!connected) Log.w(TAG, "Billing setup failed: ${result.debugMessage}")
                val waiting = pendingOnConnected.toList()
                pendingOnConnected.clear()
                if (connected) waiting.forEach { it() }
            }

            override fun onBillingServiceDisconnected() {
                connected = false
                // enableAutoServiceReconnection() already retries the connection itself;
                // callers queued here run once that reconnect calls back in.
            }
        })
    }

    /** Fetches current Play-formatted prices for the subscription's two base plans and the lifetime product. */
    fun queryOffers(
        onReady: (monthly: ChefVoiceOffer.Subscription?, annual: ChefVoiceOffer.Subscription?, lifetime: ChefVoiceOffer.Lifetime?) -> Unit
    ) {
        ensureConnected {
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(
                    listOf(
                        QueryProductDetailsParams.Product.newBuilder()
                            .setProductId(SUBSCRIPTION_PRODUCT_ID)
                            .setProductType(BillingClient.ProductType.SUBS)
                            .build(),
                        QueryProductDetailsParams.Product.newBuilder()
                            .setProductId(LIFETIME_PRODUCT_ID)
                            .setProductType(BillingClient.ProductType.INAPP)
                            .build()
                    )
                )
                .build()
            billingClient.queryProductDetailsAsync(params) { result, productDetailsResult ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "queryProductDetailsAsync failed: ${result.debugMessage}")
                    return@queryProductDetailsAsync onReady(null, null, null)
                }
                var monthly: ChefVoiceOffer.Subscription? = null
                var annual: ChefVoiceOffer.Subscription? = null
                var lifetime: ChefVoiceOffer.Lifetime? = null
                productDetailsResult.productDetailsList.forEach { details ->
                    when (details.productType) {
                        BillingClient.ProductType.SUBS -> details.subscriptionOfferDetails?.forEach { offer ->
                            val price = offer.pricingPhases.pricingPhaseList.firstOrNull()?.formattedPrice.orEmpty()
                            val resolved = ChefVoiceOffer.Subscription(details, offer.offerToken, price)
                            when (offer.basePlanId) {
                                BASE_PLAN_MONTHLY -> monthly = resolved
                                BASE_PLAN_ANNUAL -> annual = resolved
                            }
                        }
                        BillingClient.ProductType.INAPP -> {
                            val price = details.oneTimePurchaseOfferDetailsList?.firstOrNull()?.formattedPrice.orEmpty()
                            lifetime = ChefVoiceOffer.Lifetime(details, price)
                        }
                    }
                }
                onReady(monthly, annual, lifetime)
            }
        }
    }

    /** `obfuscatedAccountId` should be the signed-in Firebase uid -- see verifyAndAcknowledge and the backend's purchaseTokens mapping. */
    fun launchPurchase(activity: Activity, offer: ChefVoiceOffer, obfuscatedAccountId: String, onError: (String) -> Unit) {
        ensureConnected {
            val productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(offer.productDetails)
                .apply { if (offer is ChefVoiceOffer.Subscription) setOfferToken(offer.offerToken) }
                .build()
            val flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(productDetailsParams))
                .setObfuscatedAccountId(obfuscatedAccountId)
                .build()
            val result = billingClient.launchBillingFlow(activity, flowParams)
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                onError(result.debugMessage.ifBlank { "Could not start checkout." })
            }
        }
    }

    /**
     * Re-verifies every unfinished purchase on this Play account. Called on every
     * sign-in, not only on first install: it is what makes a purchase made on
     * another device show up here, and what re-drives acknowledgement for a
     * purchase whose earlier verify call never got the chance to acknowledge it
     * (app killed mid-flow, network drop, etc).
     */
    fun restorePurchases() {
        ensureConnected {
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
            ) { _, purchases -> purchases.forEach { verifyAndAcknowledge(it) } }
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
            ) { _, purchases -> purchases.forEach { verifyAndAcknowledge(it) } }
        }
    }

    /**
     * The one path every purchase goes through, new or restored: verify with the
     * backend first, acknowledge only once the backend confirms it wrote an
     * entitlement. Acknowledging first and verifying after would let a purchase
     * verification later rejects (or Play has already refunded) keep looking
     * acknowledged on-device with no entitlement behind it.
     */
    private fun verifyAndAcknowledge(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        val productId = purchase.products.firstOrNull() ?: return
        val functions = runCatching { FirebaseFunctions.getInstance("us-central1") }.getOrNull() ?: return

        functions.getHttpsCallable("verifyChefVoicePurchase")
            .call(mapOf("purchaseToken" to purchase.purchaseToken, "productId" to productId))
            .addOnSuccessListener {
                if (purchase.isAcknowledged) return@addOnSuccessListener
                billingClient.acknowledgePurchase(
                    AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
                ) { ack ->
                    if (ack.responseCode != BillingClient.BillingResponseCode.OK) {
                        Log.w(TAG, "acknowledgePurchase failed: ${ack.debugMessage}")
                    }
                }
            }
            .addOnFailureListener { error ->
                Log.w(TAG, "verifyChefVoicePurchase failed: ${error.message}")
                // Deliberately not acknowledged: Play keeps redelivering this purchase
                // (the next restorePurchases call, or another PurchasesUpdatedListener
                // callback) until it is actually verified.
            }
    }

    fun close() {
        billingClient.endConnection()
    }

    companion object {
        const val SUBSCRIPTION_PRODUCT_ID = "chefvoice_pro"
        const val LIFETIME_PRODUCT_ID = "chefvoice_pro_lifetime"
        const val BASE_PLAN_MONTHLY = "monthly"
        const val BASE_PLAN_ANNUAL = "annual"
    }
}
