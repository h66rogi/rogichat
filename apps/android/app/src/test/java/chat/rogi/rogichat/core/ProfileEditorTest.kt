package chat.rogi.rogichat.core

import chat.rogi.rogichat.feature.settings.*
import org.junit.Assert.*
import org.junit.Test

class ProfileEditorTest {
    @Test fun matchesServerUnicodeNicknameRules() {
        val editor = ProfileEditor("original")
        assertEquals("가", editor.edit(" \u1100\u1161\u00a0").normalized)
        assertNull(editor.edit("😀".repeat(40)).error)
        assertNotNull(editor.edit("😀".repeat(41)).error)
        assertNotNull(editor.edit("  ").error)
        assertNotNull(editor.edit("a\u200db").error)
        assertNotNull(editor.edit("a\nb").error)
        assertNotNull(editor.edit("\u0085").error)
        assertEquals(200, editor.edit("😀".repeat(250)).draft.codePointCount(0, 400))
    }
    @Test fun loadingCannotOverwriteDraftAndDiscardRestoresBaseline() {
        val edited = ProfileEditor("initial").edit("new")
        val loading = edited.copy(phase = ProfilePhase.LOADING)
        assertEquals(loading, loading.edit("late"))
        assertEquals("new", loading.copy(phase = ProfilePhase.READY).draft)
        assertTrue(edited.changed)
        assertFalse(edited.discard().changed)
        assertEquals("initial", edited.discard().draft)
    }
}
