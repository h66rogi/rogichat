package chat.rogi.rogichat.channelport.core.common.util

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString

/**
 * HTML 문자열을 일반 텍스트로 변환하여 표시하는 Composable
 *
 * 지원하는 태그: br, p, div, 그리고 일반적인 HTML 엔티티
 */
@Composable
fun HtmlText(
    html: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = MaterialTheme.colorScheme.onSurface,
) {
    val annotatedString = remember(html) { htmlToAnnotatedString(html) }

    Text(
        text = annotatedString,
        modifier = modifier,
        style = style,
        color = color,
    )
}

/**
 * HTML 문자열을 AnnotatedString으로 변환
 */
fun htmlToAnnotatedString(html: String): AnnotatedString {
    return buildAnnotatedString {
        val processed = html
            // 줄바꿈 태그 처리
            .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</p>", RegexOption.IGNORE_CASE), "\n\n")
            .replace(Regex("</div>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</li>", RegexOption.IGNORE_CASE), "\n")
            // HTML 엔티티 처리
            .replace("&nbsp;", " ")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            // 나머지 HTML 태그 제거
            .replace(Regex("<[^>]*>"), "")
            // 과도한 줄바꿈 정리
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()

        append(processed)
    }
}

