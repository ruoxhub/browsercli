# Session Management, Storage & Media Reference

Session snapshots, cookie/storage extraction, diagnostics, and HTML5 video tools for `proxycli`.

## Overview

Capture and restore authenticated states, export cookies (including HttpOnly), and control media playback.

| Tool Name               | Description                                                | Key Parameters                                                   |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `get_storage`           | Export cookies (including HttpOnly) and Web Storage        | `[--type <str>]`, `[--filter <str>]`                             |
| `save_session_state`    | Save cookies and Web Storage snapshot                      | `[--sessionId <str>]`, `[--includeCookies <bool>]`               |
| `restore_session_state` | Restore browser state from session snapshot                | `--sessionId <str>`, `[--navigateToSavedUrl <bool>]`             |
| `list_session_states`   | List all saved session state snapshots                     | None                                                             |
| `delete_session_state`  | Delete saved session snapshot                              | `--sessionId <str>`                                              |
| `dump_session_state`    | Export session state to JSON file (supports encryption)    | `--sessionId <str>`, `[--path <str>]`, `[--encrypt <bool>]`      |
| `load_session_state`    | Load external session snapshot JSON into browser           | `--sessionId <str>`, `[--path <str>]`                            |
| `capture_video_frame`   | Capture image frame from HTML5 `<video>` element           | `--selector <str>`, `[--seekTime <num>]`, `[--outputPath <str>]` |
| `get_video_info`        | Query video element duration, current time, and resolution | `--selector <str>`                                               |
| `seek_video`            | Jump video playback to specific time in seconds            | `--selector <str>`, `--time <num>`                               |

---

## Detailed Commands

### 1. get_storage

Read cookies, LocalStorage, or SessionStorage from the browser page. When `--type cookies` is specified, it returns all cookies (including `HttpOnly`) with a ready-to-copy `data.cookieHeader` string.

```bash
# Read all cookies with ready-to-copy header string
proxycli call get_storage --type cookies

# Read localStorage items
proxycli call get_storage --type localStorage
```

### 2. Session Snapshots (save / restore / dump / load)

Preserve login authentication state across restarts or share sessions between testing environments.

```bash
# Save current authenticated session
proxycli call save_session_state --sessionId "login_auth_session" --includeCookies true --includeLocalStorage true

# List all saved sessions
proxycli call list_session_states

# Restore state and navigate back to saved URL
proxycli call restore_session_state --sessionId "login_auth_session" --navigateToSavedUrl true

# Export encrypted snapshot to file
proxycli call dump_session_state --sessionId "login_auth_session" --path "artifacts/session.enc" --encrypt true
```

### 3. Video Media Controls

Inspect and capture frames from HTML5 video players (e.g. for video watermark reverse engineering, slide captures, or video player state verification).

```bash
# Get video playback metadata
proxycli call get_video_info --selector "video.main-player"

# Seek video to 45.5 seconds
proxycli call seek_video --selector "video.main-player" --time 45.5

# Capture current or seeked frame to image file
proxycli call capture_video_frame --selector "video.main-player" --seekTime 45.5 --outputPath "artifacts/frame_45s.png"
```
