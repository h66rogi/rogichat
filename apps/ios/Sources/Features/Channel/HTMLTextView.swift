import SwiftUI

struct HTMLTextView: View {
    let htmlString: String

    var body: some View {
        Text(attributedString)
            .font(.body)
            .foregroundColor(.primary)
    }

    private var attributedString: AttributedString {
        // Convert HTML to AttributedString
        let htmlData = Data(wrappedHTML.utf8)

        if let nsAttributedString = try? NSAttributedString(
            data: htmlData,
            options: [
                .documentType: NSAttributedString.DocumentType.html,
                .characterEncoding: String.Encoding.utf8.rawValue
            ],
            documentAttributes: nil
        ) {
            // Convert NSAttributedString to AttributedString
            if var attributedString = try? AttributedString(nsAttributedString, including: \.uiKit) {
                // Reset font to system font
                attributedString.font = .body
                return attributedString
            }
        }

        // Fallback: strip HTML tags
        return AttributedString(strippedHTML)
    }

    private var wrappedHTML: String {
        """
        <html>
        <head>
        <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 16px;
            line-height: 1.5;
        }
        </style>
        </head>
        <body>\(htmlString)</body>
        </html>
        """
    }

    private var strippedHTML: String {
        // Simple HTML tag stripper
        var result = htmlString
        // Replace common HTML entities
        result = result.replacingOccurrences(of: "&nbsp;", with: " ")
        result = result.replacingOccurrences(of: "&amp;", with: "&")
        result = result.replacingOccurrences(of: "&lt;", with: "<")
        result = result.replacingOccurrences(of: "&gt;", with: ">")
        result = result.replacingOccurrences(of: "&quot;", with: "\"")
        result = result.replacingOccurrences(of: "&#39;", with: "'")
        // Replace <br> with newline
        result = result.replacingOccurrences(of: "<br>", with: "\n")
        result = result.replacingOccurrences(of: "<br/>", with: "\n")
        result = result.replacingOccurrences(of: "<br />", with: "\n")
        result = result.replacingOccurrences(of: "</p>", with: "\n\n")
        result = result.replacingOccurrences(of: "</div>", with: "\n")
        // Remove all other HTML tags
        result = result.replacingOccurrences(
            of: "<[^>]+>",
            with: "",
            options: .regularExpression
        )
        // Clean up multiple newlines
        result = result.replacingOccurrences(
            of: "\n{3,}",
            with: "\n\n",
            options: .regularExpression
        )
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
