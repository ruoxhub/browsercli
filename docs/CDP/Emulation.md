# Emulation

This domain emulates different environments for the page.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [DOM](DOM.md), [Page](Page.md), [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="safeareainsets"></a>SafeAreaInsets `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `top`<br/>_optional_ | `integer` | Overrides safe-area-inset-top. |
| `topMax`<br/>_optional_ | `integer` | Overrides safe-area-max-inset-top. |
| `left`<br/>_optional_ | `integer` | Overrides safe-area-inset-left. |
| `leftMax`<br/>_optional_ | `integer` | Overrides safe-area-max-inset-left. |
| `bottom`<br/>_optional_ | `integer` | Overrides safe-area-inset-bottom. |
| `bottomMax`<br/>_optional_ | `integer` | Overrides safe-area-max-inset-bottom. |
| `right`<br/>_optional_ | `integer` | Overrides safe-area-inset-right. |
| `rightMax`<br/>_optional_ | `integer` | Overrides safe-area-max-inset-right. |


### <a name="screenorientation"></a>ScreenOrientation

Screen orientation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Orientation type.<br/>Allowed values: `"portraitPrimary"`, `"portraitSecondary"`, `"landscapePrimary"`, `"landscapeSecondary"` |
| `angle` | `integer` | Orientation angle. |


### <a name="displayfeature"></a>DisplayFeature

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `orientation` | `string` | Orientation of a display feature in relation to screen<br/>Allowed values: `"vertical"`, `"horizontal"` |
| `offset` | `integer` | The offset from the screen origin in either the x (for vertical<br/>orientation) or y (for horizontal orientation) direction. |
| `maskLength` | `integer` | A display feature may mask content such that it is not physically<br/>displayed - this length along with the offset describes this area.<br/>A display feature that only splits content will have a 0 mask_length. |


### <a name="deviceposture"></a>DevicePosture

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Current posture of the device<br/>Allowed values: `"continuous"`, `"folded"` |


### <a name="mediafeature"></a>MediaFeature

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `value` | `string` |  |


### <a name="virtualtimepolicy"></a>VirtualTimePolicy `🧪 experimental`

advance: If the scheduler runs out of immediate work, the virtual time base may fast forward to
allow the next delayed task (if any) to run; pause: The virtual time base may not advance;
pauseIfNetworkFetchesPending: The virtual time base may not advance if there are any pending
resource fetches.

* **Type**: `string`
* **Allowed values**: `"advance"`, `"pause"`, `"pauseIfNetworkFetchesPending"`

### <a name="useragentbrandversion"></a>UserAgentBrandVersion `🧪 experimental`

Used to specify User Agent Client Hints to emulate. See https://wicg.github.io/ua-client-hints

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `brand` | `string` |  |
| `version` | `string` |  |


### <a name="useragentmetadata"></a>UserAgentMetadata `🧪 experimental`

Used to specify User Agent Client Hints to emulate. See https://wicg.github.io/ua-client-hints
Missing optional values will be filled in by the target with what it would normally use.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `brands`<br/>_optional_ | array of [UserAgentBrandVersion](#useragentbrandversion) | Brands appearing in Sec-CH-UA. |
| `fullVersionList`<br/>_optional_ | array of [UserAgentBrandVersion](#useragentbrandversion) | Brands appearing in Sec-CH-UA-Full-Version-List. |
| `fullVersion`<br/>_optional_ | `string` | `⚠️ deprecated` |
| `platform` | `string` |  |
| `platformVersion` | `string` |  |
| `architecture` | `string` |  |
| `model` | `string` |  |
| `mobile` | `boolean` |  |
| `bitness`<br/>_optional_ | `string` |  |
| `wow64`<br/>_optional_ | `boolean` |  |
| `formFactors`<br/>_optional_ | array of `string` | Used to specify User Agent form-factor values.<br/>See https://wicg.github.io/ua-client-hints/#sec-ch-ua-form-factors |


### <a name="sensortype"></a>SensorType `🧪 experimental`

Used to specify sensor types to emulate.
See https://w3c.github.io/sensors/#automation for more information.

* **Type**: `string`
* **Allowed values**: `"absolute-orientation"`, `"accelerometer"`, `"ambient-light"`, `"gravity"`, `"gyroscope"`, `"linear-acceleration"`, `"magnetometer"`, `"relative-orientation"`

### <a name="sensormetadata"></a>SensorMetadata `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `available`<br/>_optional_ | `boolean` |  |
| `minimumFrequency`<br/>_optional_ | `number` |  |
| `maximumFrequency`<br/>_optional_ | `number` |  |


### <a name="sensorreadingsingle"></a>SensorReadingSingle `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `value` | `number` |  |


### <a name="sensorreadingxyz"></a>SensorReadingXYZ `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |


### <a name="sensorreadingquaternion"></a>SensorReadingQuaternion `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |
| `w` | `number` |  |


### <a name="sensorreading"></a>SensorReading `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `single`<br/>_optional_ | [SensorReadingSingle](#sensorreadingsingle) |  |
| `xyz`<br/>_optional_ | [SensorReadingXYZ](#sensorreadingxyz) |  |
| `quaternion`<br/>_optional_ | [SensorReadingQuaternion](#sensorreadingquaternion) |  |


### <a name="pressuresource"></a>PressureSource `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"cpu"`

### <a name="pressurestate"></a>PressureState `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"nominal"`, `"fair"`, `"serious"`, `"critical"`

### <a name="pressuremetadata"></a>PressureMetadata `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `available`<br/>_optional_ | `boolean` |  |


### <a name="workareainsets"></a>WorkAreaInsets `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `top`<br/>_optional_ | `integer` | Work area top inset in pixels. Default is 0; |
| `left`<br/>_optional_ | `integer` | Work area left inset in pixels. Default is 0; |
| `bottom`<br/>_optional_ | `integer` | Work area bottom inset in pixels. Default is 0; |
| `right`<br/>_optional_ | `integer` | Work area right inset in pixels. Default is 0; |


### <a name="screenid"></a>ScreenId `🧪 experimental`

* **Type**: `string`

### <a name="screeninfo"></a>ScreenInfo `🧪 experimental`

Screen information similar to the one returned by window.getScreenDetails() method,
see https://w3c.github.io/window-management/#screendetailed.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `left` | `integer` | Offset of the left edge of the screen. |
| `top` | `integer` | Offset of the top edge of the screen. |
| `width` | `integer` | Width of the screen. |
| `height` | `integer` | Height of the screen. |
| `availLeft` | `integer` | Offset of the left edge of the available screen area. |
| `availTop` | `integer` | Offset of the top edge of the available screen area. |
| `availWidth` | `integer` | Width of the available screen area. |
| `availHeight` | `integer` | Height of the available screen area. |
| `devicePixelRatio` | `number` | Specifies the screen's device pixel ratio. |
| `orientation` | [ScreenOrientation](#screenorientation) | Specifies the screen's orientation. |
| `colorDepth` | `integer` | Specifies the screen's color depth in bits. |
| `isExtended` | `boolean` | Indicates whether the device has multiple screens. |
| `isInternal` | `boolean` | Indicates whether the screen is internal to the device or external, attached to the device. |
| `isPrimary` | `boolean` | Indicates whether the screen is set as the the operating system primary screen. |
| `label` | `string` | Specifies the descriptive label for the screen. |
| `id` | [ScreenId](#screenid) | Specifies the unique identifier of the screen. |


### <a name="disabledimagetype"></a>DisabledImageType `🧪 experimental`

Enum of image types that can be disabled.

* **Type**: `string`
* **Allowed values**: `"avif"`, `"jxl"`, `"webp"`

---

<a name="commands"></a>
## Commands

### <a name="canemulate"></a>canEmulate `⚠️ deprecated`

Tells whether emulation is supported.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | `boolean` | True if emulation is supported. |


### <a name="cleardevicemetricsoverride"></a>clearDeviceMetricsOverride

Clears the overridden device metrics.

* **Parameters**: None

* **Returns**: None


### <a name="cleargeolocationoverride"></a>clearGeolocationOverride

Clears the overridden Geolocation Position and Error.

* **Parameters**: None

* **Returns**: None


### <a name="resetpagescalefactor"></a>resetPageScaleFactor `🧪 experimental`

Requests that page scale factor is reset to initial values.

* **Parameters**: None

* **Returns**: None


### <a name="setfocusemulationenabled"></a>setFocusEmulationEnabled `🧪 experimental`

Enables or disables simulating a focused and active page.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether to enable to disable focus emulation. |

* **Returns**: None


### <a name="setautodarkmodeoverride"></a>setAutoDarkModeOverride `🧪 experimental`

Automatically render all web contents using a dark theme.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled`<br/>_optional_ | `boolean` | Whether to enable or disable automatic dark mode.<br/>If not specified, any existing override will be cleared. |

* **Returns**: None


### <a name="setcputhrottlingrate"></a>setCPUThrottlingRate

Enables CPU throttling to emulate slow CPUs.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `rate` | `number` | Throttling rate as a slowdown factor (1 is no throttle, 2 is 2x slowdown, etc). |

* **Returns**: None


### <a name="setdefaultbackgroundcoloroverride"></a>setDefaultBackgroundColorOverride

Sets or clears an override of the default background color of the frame. This override is used
if the content does not specify one.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `color`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | RGBA of the default background color. If not specified, any existing override will be<br/>cleared. |

* **Returns**: None


### <a name="setsafeareainsetsoverride"></a>setSafeAreaInsetsOverride `🧪 experimental`

Overrides the values for env(safe-area-inset-*) and env(safe-area-max-inset-*). Unset values will cause the
respective variables to be undefined, even if previously overridden.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `insets` | [SafeAreaInsets](#safeareainsets) |  |

* **Returns**: None


### <a name="setdevicemetricsoverride"></a>setDeviceMetricsOverride

Overrides the values of device screen dimensions (window.screen.width, window.screen.height,
window.innerWidth, window.innerHeight, and "device-width"/"device-height"-related CSS media
query results).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `width` | `integer` | Overriding width value in pixels (minimum 0, maximum 10000000). 0 disables the override. |
| `height` | `integer` | Overriding height value in pixels (minimum 0, maximum 10000000). 0 disables the override. |
| `deviceScaleFactor` | `number` | Overriding device scale factor value. 0 disables the override. |
| `mobile` | `boolean` | Whether to emulate mobile device. This includes viewport meta tag, overlay scrollbars, text<br/>autosizing and more. |
| `scale`<br/>_optional_ | `number` | `🧪 experimental` Scale to apply to resulting view image. |
| `screenWidth`<br/>_optional_ | `integer` | `🧪 experimental` Overriding screen width value in pixels (minimum 0, maximum 10000000). |
| `screenHeight`<br/>_optional_ | `integer` | `🧪 experimental` Overriding screen height value in pixels (minimum 0, maximum 10000000). |
| `positionX`<br/>_optional_ | `integer` | `🧪 experimental` Overriding view X position on screen in pixels (minimum 0, maximum 10000000). |
| `positionY`<br/>_optional_ | `integer` | `🧪 experimental` Overriding view Y position on screen in pixels (minimum 0, maximum 10000000). |
| `dontSetVisibleSize`<br/>_optional_ | `boolean` | `🧪 experimental` Do not set visible view size, rely upon explicit setVisibleSize call. |
| `screenOrientation`<br/>_optional_ | [ScreenOrientation](#screenorientation) | Screen orientation override. |
| `viewport`<br/>_optional_ | [Page.Viewport](Page.md#viewport) | `🧪 experimental` If set, the visible area of the page will be overridden to this viewport. This viewport<br/>change is not observed by the page, e.g. viewport-relative elements do not change positions. |
| `displayFeature`<br/>_optional_ | [DisplayFeature](#displayfeature) | `🧪 experimental` `⚠️ deprecated` If set, the display feature of a multi-segment screen. If not set, multi-segment support<br/>is turned-off.<br/>Deprecated, use Emulation.setDisplayFeaturesOverride. |
| `devicePosture`<br/>_optional_ | [DevicePosture](#deviceposture) | `🧪 experimental` `⚠️ deprecated` If set, the posture of a foldable device. If not set the posture is set<br/>to continuous.<br/>Deprecated, use Emulation.setDevicePostureOverride. |
| `scrollbarType`<br/>_optional_ | `string` | `🧪 experimental` Scrollbar type. Default: `default`.<br/>Allowed values: `"overlay"`, `"default"` |
| `screenOrientationLockEmulation`<br/>_optional_ | `boolean` | `🧪 experimental` If set to true, enables screen orientation lock emulation, which<br/>intercepts screen.orientation.lock() calls from the page and reports<br/>orientation changes via screenOrientationLockChanged events. This is<br/>useful for emulating mobile device orientation lock behavior in<br/>responsive design mode. |

* **Returns**: None


### <a name="setdevicepostureoverride"></a>setDevicePostureOverride `🧪 experimental`

Start reporting the given posture value to the Device Posture API.
This override can also be set in setDeviceMetricsOverride().

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `posture` | [DevicePosture](#deviceposture) |  |

* **Returns**: None


### <a name="cleardevicepostureoverride"></a>clearDevicePostureOverride `🧪 experimental`

Clears a device posture override set with either setDeviceMetricsOverride()
or setDevicePostureOverride() and starts using posture information from the
platform again.
Does nothing if no override is set.

* **Parameters**: None

* **Returns**: None


### <a name="setdisplayfeaturesoverride"></a>setDisplayFeaturesOverride `🧪 experimental`

Start using the given display features to pupulate the Viewport Segments API.
This override can also be set in setDeviceMetricsOverride().

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `features` | array of [DisplayFeature](#displayfeature) |  |

* **Returns**: None


### <a name="cleardisplayfeaturesoverride"></a>clearDisplayFeaturesOverride `🧪 experimental`

Clears the display features override set with either setDeviceMetricsOverride()
or setDisplayFeaturesOverride() and starts using display features from the
platform again.
Does nothing if no override is set.

* **Parameters**: None

* **Returns**: None


### <a name="setscrollbarshidden"></a>setScrollbarsHidden `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `hidden` | `boolean` | Whether scrollbars should be always hidden. |

* **Returns**: None


### <a name="setdocumentcookiedisabled"></a>setDocumentCookieDisabled `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `disabled` | `boolean` | Whether document.coookie API should be disabled. |

* **Returns**: None


### <a name="setemittoucheventsformouse"></a>setEmitTouchEventsForMouse `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether touch emulation based on mouse input should be enabled. |
| `configuration`<br/>_optional_ | `string` | Touch/gesture events configuration. Default: current platform.<br/>Allowed values: `"mobile"`, `"desktop"` |

* **Returns**: None


### <a name="setemulatedmedia"></a>setEmulatedMedia

Emulates the given media type or media feature for CSS media queries.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `media`<br/>_optional_ | `string` | Media type to emulate. Empty string disables the override. |
| `features`<br/>_optional_ | array of [MediaFeature](#mediafeature) | Media features to emulate. |

* **Returns**: None


### <a name="setemulatedvisiondeficiency"></a>setEmulatedVisionDeficiency

Emulates the given vision deficiency.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Vision deficiency to emulate. Order: best-effort emulations come first, followed by any<br/>physiologically accurate emulations for medically recognized color vision deficiencies.<br/>Allowed values: `"none"`, `"blurredVision"`, `"reducedContrast"`, `"achromatopsia"`, `"deuteranopia"`, `"protanopia"`, `"tritanopia"` |

* **Returns**: None


### <a name="setemulatedostextscale"></a>setEmulatedOSTextScale

Emulates the given OS text scale.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scale`<br/>_optional_ | `number` |  |

* **Returns**: None


### <a name="setgeolocationoverride"></a>setGeolocationOverride

Overrides the Geolocation Position or Error. Omitting latitude, longitude or
accuracy emulates position unavailable.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `latitude`<br/>_optional_ | `number` | Mock latitude |
| `longitude`<br/>_optional_ | `number` | Mock longitude |
| `accuracy`<br/>_optional_ | `number` | Mock accuracy |
| `altitude`<br/>_optional_ | `number` | Mock altitude |
| `altitudeAccuracy`<br/>_optional_ | `number` | Mock altitudeAccuracy |
| `heading`<br/>_optional_ | `number` | Mock heading |
| `speed`<br/>_optional_ | `number` | Mock speed |

* **Returns**: None


### <a name="getoverriddensensorinformation"></a>getOverriddenSensorInformation `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | [SensorType](#sensortype) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `requestedSamplingFrequency` | `number` |  |


### <a name="setsensoroverrideenabled"></a>setSensorOverrideEnabled `🧪 experimental`

Overrides a platform sensor of a given type. If |enabled| is true, calls to
Sensor.start() will use a virtual sensor as backend rather than fetching
data from a real hardware sensor. Otherwise, existing virtual
sensor-backend Sensor objects will fire an error event and new calls to
Sensor.start() will attempt to use a real sensor instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` |  |
| `type` | [SensorType](#sensortype) |  |
| `metadata`<br/>_optional_ | [SensorMetadata](#sensormetadata) |  |

* **Returns**: None


### <a name="setsensoroverridereadings"></a>setSensorOverrideReadings `🧪 experimental`

Updates the sensor readings reported by a sensor type previously overridden
by setSensorOverrideEnabled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | [SensorType](#sensortype) |  |
| `reading` | [SensorReading](#sensorreading) |  |

* **Returns**: None


### <a name="setpressuresourceoverrideenabled"></a>setPressureSourceOverrideEnabled `🧪 experimental`

Overrides a pressure source of a given type, as used by the Compute
Pressure API, so that updates to PressureObserver.observe() are provided
via setPressureStateOverride instead of being retrieved from
platform-provided telemetry data.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` |  |
| `source` | [PressureSource](#pressuresource) |  |
| `metadata`<br/>_optional_ | [PressureMetadata](#pressuremetadata) |  |

* **Returns**: None


### <a name="setpressurestateoverride"></a>setPressureStateOverride `🧪 experimental`

Provides a given pressure state that will be processed and eventually be
delivered to PressureObserver users. |source| must have been previously
overridden by setPressureSourceOverrideEnabled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `source` | [PressureSource](#pressuresource) |  |
| `state` | [PressureState](#pressurestate) |  |

* **Returns**: None


### <a name="setidleoverride"></a>setIdleOverride

Overrides the Idle state.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `isUserActive` | `boolean` | Mock isUserActive |
| `isScreenUnlocked` | `boolean` | Mock isScreenUnlocked |

* **Returns**: None


### <a name="clearidleoverride"></a>clearIdleOverride

Clears Idle state overrides.

* **Parameters**: None

* **Returns**: None


### <a name="setnavigatoroverrides"></a>setNavigatorOverrides `🧪 experimental` `⚠️ deprecated`

Overrides value returned by the javascript navigator object.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `platform` | `string` | The platform navigator.platform should return. |

* **Returns**: None


### <a name="setpagescalefactor"></a>setPageScaleFactor `🧪 experimental`

Sets a specified page scale factor.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `pageScaleFactor` | `number` | Page scale factor. |

* **Returns**: None


### <a name="setscriptexecutiondisabled"></a>setScriptExecutionDisabled

Switches script execution in the page.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `value` | `boolean` | Whether script execution should be disabled in the page. |

* **Returns**: None


### <a name="settouchemulationenabled"></a>setTouchEmulationEnabled

Enables touch on platforms which do not support them.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether the touch event emulation should be enabled. |
| `maxTouchPoints`<br/>_optional_ | `integer` | Maximum touch points supported. Defaults to one. |

* **Returns**: None


### <a name="setvirtualtimepolicy"></a>setVirtualTimePolicy `🧪 experimental`

Turns on virtual time for all frames (replacing real-time with a synthetic time source) and sets
the current virtual time policy.  Note this supersedes any previous time budget.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `policy` | [VirtualTimePolicy](#virtualtimepolicy) |  |
| `budget`<br/>_optional_ | `number` | If set, after this many virtual milliseconds have elapsed virtual time will be paused and a<br/>virtualTimeBudgetExpired event is sent. |
| `maxVirtualTimeTaskStarvationCount`<br/>_optional_ | `integer` | If set this specifies the maximum number of tasks that can be run before virtual is forced<br/>forwards to prevent deadlock. |
| `initialVirtualTime`<br/>_optional_ | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | If set, base::Time::Now will be overridden to initially return this value. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `virtualTimeTicksBase` | `number` | Absolute timestamp at which virtual time was first enabled (up time in milliseconds). |


### <a name="setlocaleoverride"></a>setLocaleOverride `🧪 experimental`

Overrides default host system locale with the specified one.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `locale`<br/>_optional_ | `string` | ICU style C locale (e.g. "en_US"). If not specified or empty, disables the override and<br/>restores default host system locale. |

* **Returns**: None


### <a name="settimezoneoverride"></a>setTimezoneOverride

Overrides default host system timezone with the specified one.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `timezoneId` | `string` | The timezone identifier. List of supported timezones:<br/>https://source.chromium.org/chromium/chromium/deps/icu.git/+/faee8bc70570192d82d2978a71e2a615788597d1:source/data/misc/metaZones.txt<br/>If empty, disables the override and restores default host system timezone. |

* **Returns**: None


### <a name="setvisiblesize"></a>setVisibleSize `🧪 experimental` `⚠️ deprecated`

Resizes the frame/viewport of the page. Note that this does not affect the frame's container
(e.g. browser window). Can be used to produce screenshots of the specified size. Not supported
on Android.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `width` | `integer` | Frame width (DIP). |
| `height` | `integer` | Frame height (DIP). |

* **Returns**: None


### <a name="setdisabledimagetypes"></a>setDisabledImageTypes `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `imageTypes` | array of [DisabledImageType](#disabledimagetype) | Image types to disable. |

* **Returns**: None


### <a name="setdatasaveroverride"></a>setDataSaverOverride `🧪 experimental`

Override the value of navigator.connection.saveData

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `dataSaverEnabled`<br/>_optional_ | `boolean` | Override value. Omitting the parameter disables the override. |

* **Returns**: None


### <a name="sethardwareconcurrencyoverride"></a>setHardwareConcurrencyOverride `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `hardwareConcurrency` | `integer` | Hardware concurrency to report |

* **Returns**: None


### <a name="setuseragentoverride"></a>setUserAgentOverride

Allows overriding user agent with the given string.
`userAgentMetadata` must be set for Client Hint headers to be sent.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `userAgent` | `string` | User agent to use. |
| `acceptLanguage`<br/>_optional_ | `string` | Browser language to emulate. |
| `platform`<br/>_optional_ | `string` | The platform navigator.platform should return. |
| `userAgentMetadata`<br/>_optional_ | [UserAgentMetadata](#useragentmetadata) | `🧪 experimental` To be sent in Sec-CH-UA-* headers and returned in navigator.userAgentData |

* **Returns**: None


### <a name="setautomationoverride"></a>setAutomationOverride `🧪 experimental`

Allows overriding the automation flag.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether the override should be enabled. |

* **Returns**: None


### <a name="setsmallviewportheightdifferenceoverride"></a>setSmallViewportHeightDifferenceOverride `🧪 experimental`

Allows overriding the difference between the small and large viewport sizes, which determine the
value of the `svh` and `lvh` unit, respectively. Only supported for top-level frames.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `difference` | `integer` | This will cause an element of size 100svh to be `difference` pixels smaller than an element<br/>of size 100lvh. |

* **Returns**: None


### <a name="getscreeninfos"></a>getScreenInfos `🧪 experimental`

Returns device's screen configuration. In headful mode, the physical screens configuration is returned,
whereas in headless mode, a virtual headless screen configuration is provided instead.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `screenInfos` | array of [ScreenInfo](#screeninfo) |  |


### <a name="addscreen"></a>addScreen `🧪 experimental`

Add a new screen to the device. Only supported in headless mode.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `left` | `integer` | Offset of the left edge of the screen in pixels. |
| `top` | `integer` | Offset of the top edge of the screen in pixels. |
| `width` | `integer` | The width of the screen in pixels. |
| `height` | `integer` | The height of the screen in pixels. |
| `workAreaInsets`<br/>_optional_ | [WorkAreaInsets](#workareainsets) | Specifies the screen's work area. Default is entire screen. |
| `devicePixelRatio`<br/>_optional_ | `number` | Specifies the screen's device pixel ratio. Default is 1. |
| `rotation`<br/>_optional_ | `integer` | Specifies the screen's rotation angle. Available values are 0, 90, 180 and 270. Default is 0. |
| `colorDepth`<br/>_optional_ | `integer` | Specifies the screen's color depth in bits. Default is 24. |
| `label`<br/>_optional_ | `string` | Specifies the descriptive label for the screen. Default is none. |
| `isInternal`<br/>_optional_ | `boolean` | Indicates whether the screen is internal to the device or external, attached to the device. Default is false. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `screenInfo` | [ScreenInfo](#screeninfo) |  |


### <a name="updatescreen"></a>updateScreen `🧪 experimental`

Updates specified screen parameters. Only supported in headless mode.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `screenId` | [ScreenId](#screenid) | Target screen identifier. |
| `left`<br/>_optional_ | `integer` | Offset of the left edge of the screen in pixels. |
| `top`<br/>_optional_ | `integer` | Offset of the top edge of the screen in pixels. |
| `width`<br/>_optional_ | `integer` | The width of the screen in pixels. |
| `height`<br/>_optional_ | `integer` | The height of the screen in pixels. |
| `workAreaInsets`<br/>_optional_ | [WorkAreaInsets](#workareainsets) | Specifies the screen's work area. |
| `devicePixelRatio`<br/>_optional_ | `number` | Specifies the screen's device pixel ratio. |
| `rotation`<br/>_optional_ | `integer` | Specifies the screen's rotation angle. Available values are 0, 90, 180 and 270. |
| `colorDepth`<br/>_optional_ | `integer` | Specifies the screen's color depth in bits. |
| `label`<br/>_optional_ | `string` | Specifies the descriptive label for the screen. |
| `isInternal`<br/>_optional_ | `boolean` | Indicates whether the screen is internal to the device or external, attached to the device. Default is false. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `screenInfo` | [ScreenInfo](#screeninfo) |  |


### <a name="removescreen"></a>removeScreen `🧪 experimental`

Remove screen from the device. Only supported in headless mode.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `screenId` | [ScreenId](#screenid) |  |

* **Returns**: None


### <a name="setprimaryscreen"></a>setPrimaryScreen `🧪 experimental`

Set primary screen. Only supported in headless mode.
Note that this changes the coordinate system origin to the top-left
of the new primary screen, updating the bounds and work areas
of all existing screens accordingly.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `screenId` | [ScreenId](#screenid) |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="virtualtimebudgetexpired"></a>virtualTimeBudgetExpired `🧪 experimental`

Notification sent after the virtual time budget for the current VirtualTimePolicy has run out.

* **Parameters**: None


### <a name="screenorientationlockchanged"></a>screenOrientationLockChanged `🧪 experimental`

Fired when a page calls screen.orientation.lock() or screen.orientation.unlock()
while device emulation is enabled. This allows the DevTools frontend to update the
emulated device orientation accordingly.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `locked` | `boolean` | Whether the screen orientation is currently locked. |
| `orientation`<br/>_optional_ | [ScreenOrientation](#screenorientation) | The orientation lock type requested by the page. Only set when locked is true. |


