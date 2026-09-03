package com.chefvoice.app.model

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DirectConversationUnreadTest {
    private fun conversation(
        lastMessage: String = "hello",
        lastSenderId: String = "b",
        updatedAt: Long = 200L
    ) = DirectConversation(
        id = "a--b",
        participantIds = listOf("a", "b"),
        participantNames = mapOf("a" to "A", "b" to "B"),
        lastMessage = lastMessage,
        lastSenderId = lastSenderId,
        updatedAt = updatedAt
    )

    @Test
    fun incomingMessageNewerThanReadMarkerIsUnread() {
        assertTrue(conversation().isUnreadFor("a", 100L))
    }

    @Test
    fun currentReadMarkerClearsUnread() {
        assertFalse(conversation().isUnreadFor("a", 200L))
    }

    @Test
    fun ownLatestMessageIsNeverUnread() {
        assertFalse(conversation(lastSenderId = "a").isUnreadFor("a", 0L))
    }

    @Test
    fun emptyConversationIsNeverUnread() {
        assertFalse(conversation(lastMessage = "", lastSenderId = "").isUnreadFor("a", 0L))
    }
}
