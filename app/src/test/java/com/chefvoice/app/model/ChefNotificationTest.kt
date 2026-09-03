package com.chefvoice.app.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChefNotificationTest {
    @Test
    fun newNotificationIsUnread() {
        assertTrue(ChefNotification(readAt = 0L).isUnread)
    }

    @Test
    fun positiveReadMarkerClearsUnread() {
        assertFalse(ChefNotification(readAt = 123L).isUnread)
    }

    @Test
    fun liveNotificationKeepsDedicatedSessionId() {
        val notification = ChefNotification(type = "live", liveSessionId = "session-123")
        assertEquals("live", notification.type)
        assertEquals("session-123", notification.liveSessionId)
        assertTrue(notification.recipeId.isBlank())
        assertTrue(notification.conversationId.isBlank())
    }
}
