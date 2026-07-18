# Storage

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Browser](Browser.md), [Network](Network.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="serializedstoragekey"></a>SerializedStorageKey

* **Type**: `string`

### <a name="storagetype"></a>StorageType

Enum of possible storage types.

* **Type**: `string`
* **Allowed values**: `"cookies"`, `"file_systems"`, `"indexeddb"`, `"local_storage"`, `"shader_cache"`, `"websql"`, `"service_workers"`, `"cache_storage"`, `"interest_groups"`, `"shared_storage"`, `"storage_buckets"`, `"all"`, `"other"`

### <a name="usagefortype"></a>UsageForType

Usage for a storage type.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `storageType` | [StorageType](#storagetype) | Name of storage type. |
| `usage` | `number` | Storage usage (bytes). |


### <a name="trusttokens"></a>TrustTokens `🧪 experimental`

Pair of issuer origin and number of available (signed, but not used) Trust
Tokens from that issuer.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `issuerOrigin` | `string` |  |
| `count` | `number` |  |


### <a name="interestgroupauctionid"></a>InterestGroupAuctionId

Protected audience interest group auction identifier.

* **Type**: `string`

### <a name="interestgroupaccesstype"></a>InterestGroupAccessType

Enum of interest group access types.

* **Type**: `string`
* **Allowed values**: `"join"`, `"leave"`, `"update"`, `"loaded"`, `"bid"`, `"win"`, `"additionalBid"`, `"additionalBidWin"`, `"topLevelBid"`, `"topLevelAdditionalBid"`, `"clear"`

### <a name="interestgroupauctioneventtype"></a>InterestGroupAuctionEventType

Enum of auction events.

* **Type**: `string`
* **Allowed values**: `"started"`, `"configResolved"`

### <a name="interestgroupauctionfetchtype"></a>InterestGroupAuctionFetchType

Enum of network fetches auctions can do.

* **Type**: `string`
* **Allowed values**: `"bidderJs"`, `"bidderWasm"`, `"sellerJs"`, `"bidderTrustedSignals"`, `"sellerTrustedSignals"`

### <a name="sharedstorageaccessscope"></a>SharedStorageAccessScope

Enum of shared storage access scopes.

* **Type**: `string`
* **Allowed values**: `"window"`, `"sharedStorageWorklet"`, `"protectedAudienceWorklet"`, `"header"`

### <a name="sharedstorageaccessmethod"></a>SharedStorageAccessMethod

Enum of shared storage access methods.

* **Type**: `string`
* **Allowed values**: `"addModule"`, `"createWorklet"`, `"selectURL"`, `"run"`, `"batchUpdate"`, `"set"`, `"append"`, `"delete"`, `"clear"`, `"get"`, `"keys"`, `"values"`, `"entries"`, `"length"`, `"remainingBudget"`

### <a name="sharedstorageentry"></a>SharedStorageEntry

Struct for a single key-value pair in an origin's shared storage.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | `string` |  |
| `value` | `string` |  |


### <a name="sharedstoragemetadata"></a>SharedStorageMetadata

Details for an origin's shared storage.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `creationTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Time when the origin's shared storage was last created. |
| `length` | `integer` | Number of key-value pairs stored in origin's shared storage. |
| `remainingBudget` | `number` | Current amount of bits of entropy remaining in the navigation budget. |
| `bytesUsed` | `integer` | Total number of bytes stored as key-value pairs in origin's shared<br/>storage. |


### <a name="sharedstorageprivateaggregationconfig"></a>SharedStoragePrivateAggregationConfig

Represents a dictionary object passed in as privateAggregationConfig to
run or selectURL.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `aggregationCoordinatorOrigin`<br/>_optional_ | `string` | The chosen aggregation service deployment. |
| `contextId`<br/>_optional_ | `string` | The context ID provided. |
| `filteringIdMaxBytes` | `integer` | Configures the maximum size allowed for filtering IDs. |
| `maxContributions`<br/>_optional_ | `integer` | The limit on the number of contributions in the final report. |


### <a name="sharedstoragereportingmetadata"></a>SharedStorageReportingMetadata

Pair of reporting metadata details for a candidate URL for `selectURL()`.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `eventType` | `string` |  |
| `reportingUrl` | `string` |  |


### <a name="sharedstorageurlwithmetadata"></a>SharedStorageUrlWithMetadata

Bundles a candidate URL with its reporting metadata.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Spec of candidate URL. |
| `reportingMetadata` | array of [SharedStorageReportingMetadata](#sharedstoragereportingmetadata) | Any associated reporting metadata. |


### <a name="sharedstorageaccessparams"></a>SharedStorageAccessParams

Bundles the parameters for shared storage access events whose
presence/absence can vary according to SharedStorageAccessType.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptSourceUrl`<br/>_optional_ | `string` | Spec of the module script URL.<br/>Present only for SharedStorageAccessMethods: addModule and<br/>createWorklet. |
| `dataOrigin`<br/>_optional_ | `string` | String denoting "context-origin", "script-origin", or a custom<br/>origin to be used as the worklet's data origin.<br/>Present only for SharedStorageAccessMethod: createWorklet. |
| `operationName`<br/>_optional_ | `string` | Name of the registered operation to be run.<br/>Present only for SharedStorageAccessMethods: run and selectURL. |
| `operationId`<br/>_optional_ | `string` | ID of the operation call.<br/>Present only for SharedStorageAccessMethods: run and selectURL. |
| `keepAlive`<br/>_optional_ | `boolean` | Whether or not to keep the worket alive for future run or selectURL<br/>calls.<br/>Present only for SharedStorageAccessMethods: run and selectURL. |
| `privateAggregationConfig`<br/>_optional_ | [SharedStoragePrivateAggregationConfig](#sharedstorageprivateaggregationconfig) | Configures the private aggregation options.<br/>Present only for SharedStorageAccessMethods: run and selectURL. |
| `serializedData`<br/>_optional_ | `string` | The operation's serialized data in bytes (converted to a string).<br/>Present only for SharedStorageAccessMethods: run and selectURL.<br/>TODO(crbug.com/401011862): Consider updating this parameter to binary. |
| `urlsWithMetadata`<br/>_optional_ | array of [SharedStorageUrlWithMetadata](#sharedstorageurlwithmetadata) | Array of candidate URLs' specs, along with any associated metadata.<br/>Present only for SharedStorageAccessMethod: selectURL. |
| `urnUuid`<br/>_optional_ | `string` | Spec of the URN:UUID generated for a selectURL call.<br/>Present only for SharedStorageAccessMethod: selectURL. |
| `key`<br/>_optional_ | `string` | Key for a specific entry in an origin's shared storage.<br/>Present only for SharedStorageAccessMethods: set, append, delete, and<br/>get. |
| `value`<br/>_optional_ | `string` | Value for a specific entry in an origin's shared storage.<br/>Present only for SharedStorageAccessMethods: set and append. |
| `ignoreIfPresent`<br/>_optional_ | `boolean` | Whether or not to set an entry for a key if that key is already present.<br/>Present only for SharedStorageAccessMethod: set. |
| `workletOrdinal`<br/>_optional_ | `integer` | A number denoting the (0-based) order of the worklet's<br/>creation relative to all other shared storage worklets created by<br/>documents using the current storage partition.<br/>Present only for SharedStorageAccessMethods: addModule, createWorklet. |
| `workletTargetId`<br/>_optional_ | [Target.TargetID](Target.md#targetid) | Hex representation of the DevTools token used as the TargetID for the<br/>associated shared storage worklet.<br/>Present only for SharedStorageAccessMethods: addModule, createWorklet,<br/>run, selectURL, and any other SharedStorageAccessMethod when the<br/>SharedStorageAccessScope is sharedStorageWorklet. |
| `withLock`<br/>_optional_ | `string` | Name of the lock to be acquired, if present.<br/>Optionally present only for SharedStorageAccessMethods: batchUpdate,<br/>set, append, delete, and clear. |
| `batchUpdateId`<br/>_optional_ | `string` | If the method has been called as part of a batchUpdate, then this<br/>number identifies the batch to which it belongs.<br/>Optionally present only for SharedStorageAccessMethods:<br/>batchUpdate (required), set, append, delete, and clear. |
| `batchSize`<br/>_optional_ | `integer` | Number of modifier methods sent in batch.<br/>Present only for SharedStorageAccessMethod: batchUpdate. |


### <a name="storagebucketsdurability"></a>StorageBucketsDurability

* **Type**: `string`
* **Allowed values**: `"relaxed"`, `"strict"`

### <a name="storagebucket"></a>StorageBucket

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | [SerializedStorageKey](#serializedstoragekey) |  |
| `name`<br/>_optional_ | `string` | If not specified, it is the default bucket of the storageKey. |


### <a name="storagebucketinfo"></a>StorageBucketInfo

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `bucket` | [StorageBucket](#storagebucket) |  |
| `id` | `string` |  |
| `expiration` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) |  |
| `quota` | `number` | Storage quota (bytes). |
| `persistent` | `boolean` |  |
| `durability` | [StorageBucketsDurability](#storagebucketsdurability) |  |


### <a name="relatedwebsiteset"></a>RelatedWebsiteSet `🧪 experimental`

A single Related Website Set object.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `primarySites` | array of `string` | The primary site of this set, along with the ccTLDs if there is any. |
| `associatedSites` | array of `string` | The associated sites of this set, along with the ccTLDs if there is any. |
| `serviceSites` | array of `string` | The service sites of this set, along with the ccTLDs if there is any. |


---

<a name="commands"></a>
## Commands

### <a name="getstoragekeyforframe"></a>getStorageKeyForFrame `⚠️ deprecated`

Returns a storage key given a frame id.
Deprecated. Please use Storage.getStorageKey instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | [SerializedStorageKey](#serializedstoragekey) |  |


### <a name="getstoragekey"></a>getStorageKey `🧪 experimental`

Returns storage key for the given frame. If no frame ID is provided,
the storage key of the target executing this command is returned.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | [SerializedStorageKey](#serializedstoragekey) |  |


### <a name="cleardatafororigin"></a>clearDataForOrigin

Clears storage for origin.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Security origin. |
| `storageTypes` | `string` | Comma separated list of StorageType to clear. |

* **Returns**: None


### <a name="cleardataforstoragekey"></a>clearDataForStorageKey

Clears storage for storage key.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | `string` | Storage key. |
| `storageTypes` | `string` | Comma separated list of StorageType to clear. |

* **Returns**: None


### <a name="getcookies"></a>getCookies

Returns all browser cookies.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `browserContextId`<br/>_optional_ | [Browser.BrowserContextID](Browser.md#browsercontextid) | Browser context to use when called on the browser endpoint. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `cookies` | array of [Network.Cookie](Network.md#cookie) | Array of cookie objects. |


### <a name="setcookies"></a>setCookies

Sets given cookies.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `cookies` | array of [Network.CookieParam](Network.md#cookieparam) | Cookies to be set. |
| `browserContextId`<br/>_optional_ | [Browser.BrowserContextID](Browser.md#browsercontextid) | Browser context to use when called on the browser endpoint. |

* **Returns**: None


### <a name="clearcookies"></a>clearCookies

Clears cookies.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `browserContextId`<br/>_optional_ | [Browser.BrowserContextID](Browser.md#browsercontextid) | Browser context to use when called on the browser endpoint. |

* **Returns**: None


### <a name="getusageandquota"></a>getUsageAndQuota

Returns usage and quota in bytes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Security origin. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `usage` | `number` | Storage usage (bytes). |
| `quota` | `number` | Storage quota (bytes). |
| `overrideActive` | `boolean` | Whether or not the origin has an active storage quota override |
| `usageBreakdown` | array of [UsageForType](#usagefortype) | Storage usage per type (bytes). |


### <a name="overridequotafororigin"></a>overrideQuotaForOrigin `🧪 experimental`

Override quota for the specified origin

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Security origin. |
| `quotaSize`<br/>_optional_ | `number` | The quota size (in bytes) to override the original quota with.<br/>If this is called multiple times, the overridden quota will be equal to<br/>the quotaSize provided in the final call. If this is called without<br/>specifying a quotaSize, the quota will be reset to the default value for<br/>the specified origin. If this is called multiple times with different<br/>origins, the override will be maintained for each origin until it is<br/>disabled (called without a quotaSize). |

* **Returns**: None


### <a name="trackcachestoragefororigin"></a>trackCacheStorageForOrigin

Registers origin to be notified when an update occurs to its cache storage list.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Security origin. |

* **Returns**: None


### <a name="trackcachestorageforstoragekey"></a>trackCacheStorageForStorageKey

Registers storage key to be notified when an update occurs to its cache storage list.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | `string` | Storage key. |

* **Returns**: None


### <a name="trackindexeddbfororigin"></a>trackIndexedDBForOrigin

Registers origin to be notified when an update occurs to its IndexedDB.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Security origin. |

* **Returns**: None


### <a name="trackindexeddbforstoragekey"></a>trackIndexedDBForStorageKey

Registers storage key to be notified when an update occurs to its IndexedDB.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | `string` | Storage key. |

* **Returns**: None


### <a name="untrackcachestoragefororigin"></a>untrackCacheStorageForOrigin

Unregisters origin from receiving notifications for cache storage.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Security origin. |

* **Returns**: None


### <a name="untrackcachestorageforstoragekey"></a>untrackCacheStorageForStorageKey

Unregisters storage key from receiving notifications for cache storage.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | `string` | Storage key. |

* **Returns**: None


### <a name="untrackindexeddbfororigin"></a>untrackIndexedDBForOrigin

Unregisters origin from receiving notifications for IndexedDB.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Security origin. |

* **Returns**: None


### <a name="untrackindexeddbforstoragekey"></a>untrackIndexedDBForStorageKey

Unregisters storage key from receiving notifications for IndexedDB.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | `string` | Storage key. |

* **Returns**: None


### <a name="gettrusttokens"></a>getTrustTokens `🧪 experimental`

Returns the number of stored Trust Tokens per issuer for the
current browsing context.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `tokens` | array of [TrustTokens](#trusttokens) |  |


### <a name="cleartrusttokens"></a>clearTrustTokens `🧪 experimental`

Removes all Trust Tokens issued by the provided issuerOrigin.
Leaves other stored data, including the issuer's Redemption Records, intact.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `issuerOrigin` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `didDeleteTokens` | `boolean` | True if any tokens were deleted, false otherwise. |


### <a name="getinterestgroupdetails"></a>getInterestGroupDetails `🧪 experimental`

Gets details for a named interest group.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ownerOrigin` | `string` |  |
| `name` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `details` | `object` | This largely corresponds to:<br/>https://wicg.github.io/turtledove/#dictdef-generatebidinterestgroup<br/>but has absolute expirationTime instead of relative lifetimeMs and<br/>also adds joiningOrigin. |


### <a name="setinterestgrouptracking"></a>setInterestGroupTracking `🧪 experimental`

Enables/Disables issuing of interestGroupAccessed events.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enable` | `boolean` |  |

* **Returns**: None


### <a name="setinterestgroupauctiontracking"></a>setInterestGroupAuctionTracking `🧪 experimental`

Enables/Disables issuing of interestGroupAuctionEventOccurred and
interestGroupAuctionNetworkRequestCreated.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enable` | `boolean` |  |

* **Returns**: None


### <a name="getsharedstoragemetadata"></a>getSharedStorageMetadata `🧪 experimental`

Gets metadata for an origin's shared storage.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ownerOrigin` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `metadata` | [SharedStorageMetadata](#sharedstoragemetadata) |  |


### <a name="getsharedstorageentries"></a>getSharedStorageEntries `🧪 experimental`

Gets the entries in an given origin's shared storage.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ownerOrigin` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `entries` | array of [SharedStorageEntry](#sharedstorageentry) |  |


### <a name="setsharedstorageentry"></a>setSharedStorageEntry `🧪 experimental`

Sets entry with `key` and `value` for a given origin's shared storage.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ownerOrigin` | `string` |  |
| `key` | `string` |  |
| `value` | `string` |  |
| `ignoreIfPresent`<br/>_optional_ | `boolean` | If `ignoreIfPresent` is included and true, then only sets the entry if<br/>`key` doesn't already exist. |

* **Returns**: None


### <a name="deletesharedstorageentry"></a>deleteSharedStorageEntry `🧪 experimental`

Deletes entry for `key` (if it exists) for a given origin's shared storage.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ownerOrigin` | `string` |  |
| `key` | `string` |  |

* **Returns**: None


### <a name="clearsharedstorageentries"></a>clearSharedStorageEntries `🧪 experimental`

Clears all entries for a given origin's shared storage.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ownerOrigin` | `string` |  |

* **Returns**: None


### <a name="resetsharedstoragebudget"></a>resetSharedStorageBudget `🧪 experimental`

Resets the budget for `ownerOrigin` by clearing all budget withdrawals.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ownerOrigin` | `string` |  |

* **Returns**: None


### <a name="setsharedstoragetracking"></a>setSharedStorageTracking `🧪 experimental`

Enables/disables issuing of sharedStorageAccessed events.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enable` | `boolean` |  |

* **Returns**: None


### <a name="setstoragebuckettracking"></a>setStorageBucketTracking `🧪 experimental`

Set tracking for a storage key's buckets.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageKey` | `string` |  |
| `enable` | `boolean` |  |

* **Returns**: None


### <a name="deletestoragebucket"></a>deleteStorageBucket `🧪 experimental`

Deletes the Storage Bucket with the given storage key and bucket name.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `bucket` | [StorageBucket](#storagebucket) |  |

* **Returns**: None


### <a name="runbouncetrackingmitigations"></a>runBounceTrackingMitigations `🧪 experimental`

Deletes state for sites identified as potential bounce trackers, immediately.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `deletedSites` | array of `string` |  |


### <a name="getrelatedwebsitesets"></a>getRelatedWebsiteSets `🧪 experimental`

Returns the effective Related Website Sets in use by this profile for the browser
session. The effective Related Website Sets will not change during a browser session.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `sets` | array of [RelatedWebsiteSet](#relatedwebsiteset) |  |


### <a name="setprotectedaudiencekanonymity"></a>setProtectedAudienceKAnonymity

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `owner` | `string` |  |
| `name` | `string` |  |
| `hashes` | array of `string` |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="cachestoragecontentupdated"></a>cacheStorageContentUpdated

A cache's contents have been modified.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Origin to update. |
| `storageKey` | `string` | Storage key to update. |
| `bucketId` | `string` | Storage bucket to update. |
| `cacheName` | `string` | Name of cache in origin. |


### <a name="cachestoragelistupdated"></a>cacheStorageListUpdated

A cache has been added/deleted.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Origin to update. |
| `storageKey` | `string` | Storage key to update. |
| `bucketId` | `string` | Storage bucket to update. |


### <a name="indexeddbcontentupdated"></a>indexedDBContentUpdated

The origin's IndexedDB object store has been modified.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Origin to update. |
| `storageKey` | `string` | Storage key to update. |
| `bucketId` | `string` | Storage bucket to update. |
| `databaseName` | `string` | Database to update. |
| `objectStoreName` | `string` | ObjectStore to update. |


### <a name="indexeddblistupdated"></a>indexedDBListUpdated

The origin's IndexedDB database list has been modified.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Origin to update. |
| `storageKey` | `string` | Storage key to update. |
| `bucketId` | `string` | Storage bucket to update. |


### <a name="interestgroupaccessed"></a>interestGroupAccessed

One of the interest groups was accessed. Note that these events are global
to all targets sharing an interest group store.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `accessTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) |  |
| `type` | [InterestGroupAccessType](#interestgroupaccesstype) |  |
| `ownerOrigin` | `string` |  |
| `name` | `string` |  |
| `componentSellerOrigin`<br/>_optional_ | `string` | For topLevelBid/topLevelAdditionalBid, and when appropriate,<br/>win and additionalBidWin |
| `bid`<br/>_optional_ | `number` | For bid or somethingBid event, if done locally and not on a server. |
| `bidCurrency`<br/>_optional_ | `string` |  |
| `uniqueAuctionId`<br/>_optional_ | [InterestGroupAuctionId](#interestgroupauctionid) | For non-global events --- links to interestGroupAuctionEvent |


### <a name="interestgroupauctioneventoccurred"></a>interestGroupAuctionEventOccurred

An auction involving interest groups is taking place. These events are
target-specific.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) |  |
| `type` | [InterestGroupAuctionEventType](#interestgroupauctioneventtype) |  |
| `uniqueAuctionId` | [InterestGroupAuctionId](#interestgroupauctionid) |  |
| `parentAuctionId`<br/>_optional_ | [InterestGroupAuctionId](#interestgroupauctionid) | Set for child auctions. |
| `auctionConfig`<br/>_optional_ | `object` | Set for started and configResolved |


### <a name="interestgroupauctionnetworkrequestcreated"></a>interestGroupAuctionNetworkRequestCreated

Specifies which auctions a particular network fetch may be related to, and
in what role. Note that it is not ordered with respect to
Network.requestWillBeSent (but will happen before loadingFinished
loadingFailed).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | [InterestGroupAuctionFetchType](#interestgroupauctionfetchtype) |  |
| `requestId` | [Network.RequestId](Network.md#requestid) |  |
| `auctions` | array of [InterestGroupAuctionId](#interestgroupauctionid) | This is the set of the auctions using the worklet that issued this<br/>request.  In the case of trusted signals, it's possible that only some of<br/>them actually care about the keys being queried. |


### <a name="sharedstorageaccessed"></a>sharedStorageAccessed

Shared storage was accessed by the associated page.
The following parameters are included in all events.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `accessTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Time of the access. |
| `scope` | [SharedStorageAccessScope](#sharedstorageaccessscope) | Enum value indicating the access scope. |
| `method` | [SharedStorageAccessMethod](#sharedstorageaccessmethod) | Enum value indicating the Shared Storage API method invoked. |
| `mainFrameId` | [Page.FrameId](Page.md#frameid) | DevTools Frame Token for the primary frame tree's root. |
| `ownerOrigin` | `string` | Serialization of the origin owning the Shared Storage data. |
| `ownerSite` | `string` | Serialization of the site owning the Shared Storage data. |
| `params` | [SharedStorageAccessParams](#sharedstorageaccessparams) | The sub-parameters wrapped by `params` are all optional and their<br/>presence/absence depends on `type`. |


### <a name="sharedstorageworkletoperationexecutionfinished"></a>sharedStorageWorkletOperationExecutionFinished

A shared storage run or selectURL operation finished its execution.
The following parameters are included in all events.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `finishedTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Time that the operation finished. |
| `executionTime` | `integer` | Time, in microseconds, from start of shared storage JS API call until<br/>end of operation execution in the worklet. |
| `method` | [SharedStorageAccessMethod](#sharedstorageaccessmethod) | Enum value indicating the Shared Storage API method invoked. |
| `operationId` | `string` | ID of the operation call. |
| `workletTargetId` | [Target.TargetID](Target.md#targetid) | Hex representation of the DevTools token used as the TargetID for the<br/>associated shared storage worklet. |
| `mainFrameId` | [Page.FrameId](Page.md#frameid) | DevTools Frame Token for the primary frame tree's root. |
| `ownerOrigin` | `string` | Serialization of the origin owning the Shared Storage data. |


### <a name="storagebucketcreatedorupdated"></a>storageBucketCreatedOrUpdated

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `bucketInfo` | [StorageBucketInfo](#storagebucketinfo) |  |


### <a name="storagebucketdeleted"></a>storageBucketDeleted

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `bucketId` | `string` |  |


