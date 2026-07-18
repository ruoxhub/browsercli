# HeadlessExperimental

`🧪 Experimental`

This domain provides experimental commands only supported in headless mode.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Page](Page.md), [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="screenshotparams"></a>ScreenshotParams

Encoding options for a screenshot.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `format`<br/>_optional_ | `string` | Image compression format (defaults to png).<br/>Allowed values: `"jpeg"`, `"png"`, `"webp"` |
| `quality`<br/>_optional_ | `integer` | Compression quality from range [0..100] (jpeg and webp only). |
| `optimizeForSpeed`<br/>_optional_ | `boolean` | Optimize image encoding for speed, not for resulting size (defaults to false) |


---

<a name="commands"></a>
## Commands

### <a name="beginframe"></a>beginFrame

Sends a BeginFrame to the target and returns when the frame was completed. Optionally captures a
screenshot from the resulting frame. Requires that the target was created with enabled
BeginFrameControl. Designed for use with --run-all-compositor-stages-before-draw, see also
https://goo.gle/chrome-headless-rendering for more background.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameTimeTicks`<br/>_optional_ | `number` | Timestamp of this BeginFrame in Renderer TimeTicks (milliseconds of uptime). If not set,<br/>the current time will be used. |
| `interval`<br/>_optional_ | `number` | The interval between BeginFrames that is reported to the compositor, in milliseconds.<br/>Defaults to a 60 frames/second interval, i.e. about 16.666 milliseconds. |
| `noDisplayUpdates`<br/>_optional_ | `boolean` | Whether updates should not be committed and drawn onto the display. False by default. If<br/>true, only side effects of the BeginFrame will be run, such as layout and animations, but<br/>any visual updates may not be visible on the display or in screenshots. |
| `screenshot`<br/>_optional_ | [ScreenshotParams](#screenshotparams) | If set, a screenshot of the frame will be captured and returned in the response. Otherwise,<br/>no screenshot will be captured. Note that capturing a screenshot can fail, for example,<br/>during renderer initialization. In such a case, no screenshot data will be returned. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `hasDamage` | `boolean` | Whether the BeginFrame resulted in damage and, thus, a new frame was committed to the<br/>display. Reported for diagnostic uses, may be removed in the future. |
| `screenshotData`<br/>_optional_ | `string` | Base64-encoded image data of the screenshot, if one was requested and successfully taken. (Encoded as a base64 string when passed over JSON) |


### <a name="disable"></a>disable `⚠️ deprecated`

Disables headless events for the target.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable `⚠️ deprecated`

Enables headless events for the target.

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

_None_

