package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.conversation.ConversationPublicationFence
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class ConversationPublicationTest {
    @Test fun invalidationCannotSlipBetweenCurrentPredicateAndPrivateStateWrite() {
        val fence = ConversationPublicationFence()
        val predicateChecked = CountDownLatch(1); val permitWrite = CountDownLatch(1); val invalidatorStarted = CountDownLatch(1)
        val threads = Executors.newFixedThreadPool(2)
        var current = true; var visible: String? = null
        try {
            val publication = threads.submit {
                fence.publish({ current }) {
                    predicateChecked.countDown()
                    check(permitWrite.await(5, TimeUnit.SECONDS))
                    visible = "private projection"
                }
            }
            assertTrue(predicateChecked.await(5, TimeUnit.SECONDS))
            val invalidation = threads.submit {
                invalidatorStarted.countDown()
                fence.serial { current = false; visible = null }
            }
            assertTrue(invalidatorStarted.await(5, TimeUnit.SECONDS))
            // While the old write is gated after its predicate, invalidation cannot complete.
            assertFalse(invalidation.isDone)
            permitWrite.countDown(); publication.get(5, TimeUnit.SECONDS); invalidation.get(5, TimeUnit.SECONDS)
            assertNull(fence.serial { visible })
            fence.publish({ current }) { visible = "late old projection" }
            assertNull(fence.serial { visible })
        } finally { permitWrite.countDown(); threads.shutdownNow(); assertTrue(threads.awaitTermination(5, TimeUnit.SECONDS)) }
    }
}
