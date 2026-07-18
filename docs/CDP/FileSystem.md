# FileSystem

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Network](Network.md), [Storage](Storage.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="file"></a>File

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `lastModified` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Timestamp |
| `size` | `number` | Size in bytes |
| `type` | `string` |  |


### <a name="directory"></a>Directory

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `nestedDirectories` | array of `string` |  |
| `nestedFiles` | array of [File](#file) | Files that are directly nested under this directory. |


### <a name="bucketfilesystemlocator"></a>BucketFileSystemLocator

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | [Storage.SerializedStorageKey](Storage.md#serializedstoragekey) | Storage key |
| `bucketName`<br/>_optional_ | `string` | Bucket name. Not passing a `bucketName` will retrieve the default Bucket. (https://developer.mozilla.org/en-US/docs/Web/API/Storage_API#storage_buckets) |
| `pathComponents` | array of `string` | Path to the directory using each path component as an array item. |


---

<a name="commands"></a>
## Commands

### <a name="getdirectory"></a>getDirectory

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `bucketFileSystemLocator` | [BucketFileSystemLocator](#bucketfilesystemlocator) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `directory` | [Directory](#directory) | Returns the directory object at the path. |


---

<a name="events"></a>
## Events

_None_

