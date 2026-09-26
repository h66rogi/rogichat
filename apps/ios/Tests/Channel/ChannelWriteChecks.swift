import Foundation

@main struct ChannelWriteChecks {
    static func object<T: Encodable>(_ value: T) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
    }
    static func main() throws {
        let song = try object(UpdateSongRequest(title: "노래", artistName: "가수", categoryNames: []))
        precondition(song["artistId"] == nil && song["categoryIds"] == nil)
        precondition((song["categoryNames"] as? [String]) == [])
        for key in ["difficulty", "albumArt", "songKey", "bpm", "karaokeUrl", "originalUrl", "coverUrl", "lyricsLink", "lyricsText"] {
            precondition(song[key] is NSNull, "cleared field must be explicit: " + key)
        }
        let schedule = try object(UpdateScheduleRequest(title: "일정", allDay: false))
        precondition(schedule["startAt"] == nil)
        precondition(schedule["allDay"] as? Bool == false)
        for key in ["content", "endAt", "location", "externalUrl"] { precondition(schedule[key] is NSNull) }
        let channel = try object(UpdateChannelRequestBody(name: "후로기", webPath: "h66rogi", profileImageUrl: nil,
            additionalLinks: [], themeColor: "#ff8c9d", channelDescription: nil, visibility: "UNLISTED"))
        precondition(channel["visibility"] as? String == "UNLISTED")
        precondition(channel["profileImageUrl"] is NSNull)
        precondition(channel["channelDescription"] as? String == "")
        print("Channel write contracts passed")
    }
}
