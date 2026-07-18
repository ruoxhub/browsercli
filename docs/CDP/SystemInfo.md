# SystemInfo

`🧪 Experimental`

The SystemInfo domain defines methods and events for querying low-level system information.

* **Source**: Browser Protocol (Chromium)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="gpudevice"></a>GPUDevice

Describes a single graphics processor (GPU).

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `vendorId` | `number` | PCI ID of the GPU vendor, if available; 0 otherwise. |
| `deviceId` | `number` | PCI ID of the GPU device, if available; 0 otherwise. |
| `subSysId`<br/>_optional_ | `number` | Sub sys ID of the GPU, only available on Windows. |
| `revision`<br/>_optional_ | `number` | Revision of the GPU, only available on Windows. |
| `vendorString` | `string` | String description of the GPU vendor, if the PCI ID is not available. |
| `deviceString` | `string` | String description of the GPU device, if the PCI ID is not available. |
| `driverVendor` | `string` | String description of the GPU driver vendor. |
| `driverVersion` | `string` | String description of the GPU driver version. |


### <a name="size"></a>Size

Describes the width and height dimensions of an entity.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `width` | `integer` | Width in pixels. |
| `height` | `integer` | Height in pixels. |


### <a name="videodecodeacceleratorcapability"></a>VideoDecodeAcceleratorCapability

Describes a supported video decoding profile with its associated minimum and
maximum resolutions.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `profile` | `string` | Video codec profile that is supported, e.g. VP9 Profile 2. |
| `maxResolution` | [Size](#size) | Maximum video dimensions in pixels supported for this \|profile\|. |
| `minResolution` | [Size](#size) | Minimum video dimensions in pixels supported for this \|profile\|. |


### <a name="videoencodeacceleratorcapability"></a>VideoEncodeAcceleratorCapability

Describes a supported video encoding profile with its associated maximum
resolution and maximum framerate.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `profile` | `string` | Video codec profile that is supported, e.g H264 Main. |
| `maxResolution` | [Size](#size) | Maximum video dimensions in pixels supported for this \|profile\|. |
| `maxFramerateNumerator` | `integer` | Maximum encoding framerate in frames per second supported for this<br/>\|profile\|, as fraction's numerator and denominator, e.g. 24/1 fps,<br/>24000/1001 fps, etc. |
| `maxFramerateDenominator` | `integer` |  |


### <a name="subsamplingformat"></a>SubsamplingFormat

YUV subsampling type of the pixels of a given image.

* **Type**: `string`
* **Allowed values**: `"yuv420"`, `"yuv422"`, `"yuv444"`

### <a name="imagetype"></a>ImageType

Image format of a given image.

* **Type**: `string`
* **Allowed values**: `"jpeg"`, `"webp"`, `"unknown"`

### <a name="gpuinfo"></a>GPUInfo

Provides information about the GPU(s) on the system.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `devices` | array of [GPUDevice](#gpudevice) | The graphics devices on the system. Element 0 is the primary GPU. |
| `auxAttributes`<br/>_optional_ | `object` | An optional dictionary of additional GPU related attributes. |
| `featureStatus`<br/>_optional_ | `object` | An optional dictionary of graphics features and their status. |
| `driverBugWorkarounds` | array of `string` | An optional array of GPU driver bug workarounds. |
| `videoDecoding` | array of [VideoDecodeAcceleratorCapability](#videodecodeacceleratorcapability) | Supported accelerated video decoding capabilities. |
| `videoEncoding` | array of [VideoEncodeAcceleratorCapability](#videoencodeacceleratorcapability) | Supported accelerated video encoding capabilities. |


### <a name="processinfo"></a>ProcessInfo

Represents process info.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Specifies process type. |
| `id` | `integer` | Specifies process id. |
| `cpuTime` | `number` | Specifies cumulative CPU usage in seconds across all threads of the<br/>process since the process start. |


---

<a name="commands"></a>
## Commands

### <a name="getinfo"></a>getInfo

Returns information about the system.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `gpu` | [GPUInfo](#gpuinfo) | Information about the GPUs on the system. |
| `modelName` | `string` | A platform-dependent description of the model of the machine. On Mac OS, this is, for<br/>example, 'MacBookPro'. Will be the empty string if not supported. |
| `modelVersion` | `string` | A platform-dependent description of the version of the machine. On Mac OS, this is, for<br/>example, '10.1'. Will be the empty string if not supported. |
| `commandLine` | `string` | The command line string used to launch the browser. Will be the empty string if not<br/>supported. |


### <a name="getfeaturestate"></a>getFeatureState

Returns information about the feature state.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `featureState` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `featureEnabled` | `boolean` |  |


### <a name="getprocessinfo"></a>getProcessInfo

Returns information about all running processes.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `processInfo` | array of [ProcessInfo](#processinfo) | An array of process info blocks. |


---

<a name="events"></a>
## Events

_None_

