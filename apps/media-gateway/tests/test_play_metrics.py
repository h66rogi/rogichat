from meloming_media_gateway.app import PLAY_EXTRACT, _classify_extract_error


class TestClassifyExtractError:
    def test_bot_block_phrase(self):
        # YouTube's actual bot-challenge wording, surfaced by yt-dlp as a
        # DownloadError message. Triggered when the egress IP gets flagged.
        assert (
            _classify_extract_error(
                Exception("Sign in to confirm you're not a bot")
            )
            == "bot_block"
        )

    def test_bot_block_alt_phrase(self):
        assert (
            _classify_extract_error(Exception("are you a bot? please verify."))
            == "bot_block"
        )

    def test_unavailable_video(self):
        assert (
            _classify_extract_error(Exception("Video unavailable"))
            == "unavailable"
        )

    def test_unavailable_private(self):
        assert (
            _classify_extract_error(Exception("Private video"))
            == "unavailable"
        )

    def test_unavailable_removed(self):
        assert (
            _classify_extract_error(
                Exception("This video has been removed by the uploader")
            )
            == "unavailable"
        )

    def test_no_muxed_internal_marker(self):
        assert _classify_extract_error(RuntimeError("no_muxed_format")) == "no_muxed"
        assert (
            _classify_extract_error(RuntimeError("muxed_format_missing_url"))
            == "no_muxed"
        )

    def test_runtime_error_with_other_message_is_other(self):
        # RuntimeError without one of the internal markers shouldn't be
        # mis-classified as "no_muxed".
        assert _classify_extract_error(RuntimeError("kaboom")) == "other"

    def test_unknown_exception(self):
        assert _classify_extract_error(Exception("kaboom")) == "other"


def test_play_extract_counter_registered():
    # Smoke check that the Counter exists with the right name + label.
    PLAY_EXTRACT.labels(outcome="success").inc(0)
    PLAY_EXTRACT.labels(outcome="bot_block").inc(0)
    PLAY_EXTRACT.labels(outcome="other").inc(0)
