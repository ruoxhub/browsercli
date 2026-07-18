# Page

Actions and events related to the inspected page belong to the page domain.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Debugger](Debugger.md), [DOM](DOM.md), [IO](IO.md), [Network](Network.md), [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="frameid"></a>FrameId

Unique frame identifier.

* **Type**: `string`

### <a name="adframetype"></a>AdFrameType `🧪 experimental`

Indicates whether a frame has been identified as an ad.

* **Type**: `string`
* **Allowed values**: `"none"`, `"child"`, `"root"`

### <a name="adframeexplanation"></a>AdFrameExplanation `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"ParentIsAd"`, `"CreatedByAdScript"`, `"MatchedBlockingRule"`

### <a name="adframestatus"></a>AdFrameStatus `🧪 experimental`

Indicates whether a frame has been identified as an ad and why.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `adFrameType` | [AdFrameType](#adframetype) |  |
| `explanations`<br/>_optional_ | array of [AdFrameExplanation](#adframeexplanation) |  |


### <a name="securecontexttype"></a>SecureContextType `🧪 experimental`

Indicates whether the frame is a secure context and why it is the case.

* **Type**: `string`
* **Allowed values**: `"Secure"`, `"SecureLocalhost"`, `"InsecureScheme"`, `"InsecureAncestor"`

### <a name="crossoriginisolatedcontexttype"></a>CrossOriginIsolatedContextType `🧪 experimental`

Indicates whether the frame is cross-origin isolated and why it is the case.

* **Type**: `string`
* **Allowed values**: `"Isolated"`, `"NotIsolated"`, `"NotIsolatedFeatureDisabled"`

### <a name="gatedapifeatures"></a>GatedAPIFeatures `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"SharedArrayBuffers"`, `"SharedArrayBuffersTransferAllowed"`, `"PerformanceMeasureMemory"`, `"PerformanceProfile"`

### <a name="permissionspolicyfeature"></a>PermissionsPolicyFeature `🧪 experimental`

All Permissions Policy features. This enum should match the one defined
in services/network/public/cpp/permissions_policy/permissions_policy_features.json5.
LINT.IfChange(PermissionsPolicyFeature)

* **Type**: `string`
* **Allowed values**: `"accelerometer"`, `"all-screens-capture"`, `"ambient-light-sensor"`, `"aria-notify"`, `"attribution-reporting"`, `"autofill"`, `"autoplay"`, `"bluetooth"`, `"browsing-topics"`, `"camera"`, `"captured-surface-control"`, `"ch-dpr"`, `"ch-device-memory"`, `"ch-downlink"`, `"ch-ect"`, `"ch-prefers-color-scheme"`, `"ch-prefers-reduced-motion"`, `"ch-prefers-reduced-transparency"`, `"ch-rtt"`, `"ch-save-data"`, `"ch-ua"`, `"ch-ua-arch"`, `"ch-ua-bitness"`, `"ch-ua-high-entropy-values"`, `"ch-ua-platform"`, `"ch-ua-model"`, `"ch-ua-mobile"`, `"ch-ua-form-factors"`, `"ch-ua-full-version"`, `"ch-ua-full-version-list"`, `"ch-ua-platform-version"`, `"ch-ua-wow64"`, `"ch-viewport-height"`, `"ch-viewport-width"`, `"ch-width"`, `"clipboard-read"`, `"clipboard-write"`, `"compute-pressure"`, `"controlled-frame"`, `"cross-origin-isolated"`, `"deferred-fetch"`, `"deferred-fetch-minimal"`, `"device-attributes"`, `"digital-credentials-create"`, `"digital-credentials-get"`, `"direct-sockets"`, `"direct-sockets-multicast"`, `"display-capture"`, `"document-domain"`, `"encrypted-media"`, `"execution-while-out-of-viewport"`, `"execution-while-not-rendered"`, `"focus-without-user-activation"`, `"fullscreen"`, `"frobulate"`, `"gamepad"`, `"geolocation"`, `"gyroscope"`, `"hid"`, `"identity-credentials-get"`, `"idle-detection"`, `"interest-cohort"`, `"join-ad-interest-group"`, `"keyboard-map"`, `"language-detector"`, `"language-model"`, `"local-fonts"`, `"local-network"`, `"local-network-access"`, `"loopback-network"`, `"magnetometer"`, `"manual-text"`, `"media-playback-while-not-visible"`, `"microphone"`, `"midi"`, `"on-device-speech-recognition"`, `"otp-credentials"`, `"payment"`, `"picture-in-picture"`, `"private-aggregation"`, `"private-state-token-issuance"`, `"private-state-token-redemption"`, `"publickey-credentials-create"`, `"publickey-credentials-get"`, `"record-ad-auction-events"`, `"rewriter"`, `"run-ad-auction"`, `"screen-wake-lock"`, `"serial"`, `"shared-storage"`, `"shared-storage-select-url"`, `"smart-card"`, `"speaker-selection"`, `"storage-access"`, `"sub-apps"`, `"summarizer"`, `"sync-xhr"`, `"tools"`, `"translator"`, `"unload"`, `"usb"`, `"usb-unrestricted"`, `"vertical-scroll"`, `"web-app-installation"`, `"webnn"`, `"web-printing"`, `"web-share"`, `"window-management"`, `"writer"`, `"xr-spatial-tracking"`

### <a name="permissionspolicyblockreason"></a>PermissionsPolicyBlockReason `🧪 experimental`

Reason for a permissions policy feature to be disabled.

* **Type**: `string`
* **Allowed values**: `"Header"`, `"IframeAttribute"`, `"InFencedFrameTree"`, `"InIsolatedApp"`

### <a name="permissionspolicyblocklocator"></a>PermissionsPolicyBlockLocator `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) |  |
| `blockReason` | [PermissionsPolicyBlockReason](#permissionspolicyblockreason) |  |


### <a name="permissionspolicyfeaturestate"></a>PermissionsPolicyFeatureState `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `feature` | [PermissionsPolicyFeature](#permissionspolicyfeature) |  |
| `allowed` | `boolean` |  |
| `locator`<br/>_optional_ | [PermissionsPolicyBlockLocator](#permissionspolicyblocklocator) |  |


### <a name="origintrialtokenstatus"></a>OriginTrialTokenStatus `🧪 experimental`

Origin Trial(https://www.chromium.org/blink/origin-trials) support.
Status for an Origin Trial token.

* **Type**: `string`
* **Allowed values**: `"Success"`, `"NotSupported"`, `"Insecure"`, `"Expired"`, `"WrongOrigin"`, `"InvalidSignature"`, `"Malformed"`, `"WrongVersion"`, `"FeatureDisabled"`, `"TokenDisabled"`, `"FeatureDisabledForUser"`, `"UnknownTrial"`

### <a name="origintrialstatus"></a>OriginTrialStatus `🧪 experimental`

Status for an Origin Trial.

* **Type**: `string`
* **Allowed values**: `"Enabled"`, `"ValidTokenNotProvided"`, `"OSNotSupported"`, `"TrialNotAllowed"`

### <a name="origintrialusagerestriction"></a>OriginTrialUsageRestriction `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"None"`, `"Subset"`

### <a name="origintrialtoken"></a>OriginTrialToken `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` |  |
| `matchSubDomains` | `boolean` |  |
| `trialName` | `string` |  |
| `expiryTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) |  |
| `isThirdParty` | `boolean` |  |
| `usageRestriction` | [OriginTrialUsageRestriction](#origintrialusagerestriction) |  |


### <a name="origintrialtokenwithstatus"></a>OriginTrialTokenWithStatus `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `rawTokenText` | `string` |  |
| `parsedToken`<br/>_optional_ | [OriginTrialToken](#origintrialtoken) | `parsedToken` is present only when the token is extractable and<br/>parsable. |
| `status` | [OriginTrialTokenStatus](#origintrialtokenstatus) |  |


### <a name="origintrial"></a>OriginTrial `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `trialName` | `string` |  |
| `status` | [OriginTrialStatus](#origintrialstatus) |  |
| `tokensWithStatus` | array of [OriginTrialTokenWithStatus](#origintrialtokenwithstatus) |  |


### <a name="securityorigindetails"></a>SecurityOriginDetails `🧪 experimental`

Additional information about the frame document's security origin.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `isLocalhost` | `boolean` | Indicates whether the frame document's security origin is one<br/>of the local hostnames (e.g. "localhost") or IP addresses (IPv4<br/>127.0.0.0/8 or IPv6 ::1). |


### <a name="frame"></a>Frame

Information about the Frame on the page.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [FrameId](#frameid) | Frame unique identifier. |
| `parentId`<br/>_optional_ | [FrameId](#frameid) | Parent frame identifier. |
| `loaderId` | [Network.LoaderId](Network.md#loaderid) | Identifier of the loader associated with this frame. |
| `name`<br/>_optional_ | `string` | Frame's name as specified in the tag. |
| `url` | `string` | Frame document's URL without fragment. |
| `urlFragment`<br/>_optional_ | `string` | `🧪 experimental` Frame document's URL fragment including the '#'. |
| `domainAndRegistry` | `string` | `🧪 experimental` Frame document's registered domain, taking the public suffixes list into account.<br/>Extracted from the Frame's url.<br/>Example URLs: http://www.google.com/file.html -> "google.com"<br/>              http://a.b.co.uk/file.html      -> "b.co.uk" |
| `securityOrigin` | `string` | Frame document's security origin. |
| `securityOriginDetails`<br/>_optional_ | [SecurityOriginDetails](#securityorigindetails) | `🧪 experimental` Additional details about the frame document's security origin. |
| `mimeType` | `string` | Frame document's mimeType as determined by the browser. |
| `unreachableUrl`<br/>_optional_ | `string` | `🧪 experimental` If the frame failed to load, this contains the URL that could not be loaded. Note that unlike url above, this URL may contain a fragment. |
| `adFrameStatus`<br/>_optional_ | [AdFrameStatus](#adframestatus) | `🧪 experimental` Indicates whether this frame was tagged as an ad and why. |
| `secureContextType` | [SecureContextType](#securecontexttype) | `🧪 experimental` Indicates whether the main document is a secure context and explains why that is the case. |
| `crossOriginIsolatedContextType` | [CrossOriginIsolatedContextType](#crossoriginisolatedcontexttype) | `🧪 experimental` Indicates whether this is a cross origin isolated context. |
| `gatedAPIFeatures` | array of [GatedAPIFeatures](#gatedapifeatures) | `🧪 experimental` Indicated which gated APIs / features are available. |


### <a name="frameresource"></a>FrameResource `🧪 experimental`

Information about the Resource on the page.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Resource URL. |
| `type` | [Network.ResourceType](Network.md#resourcetype) | Type of this resource. |
| `mimeType` | `string` | Resource mimeType as determined by the browser. |
| `lastModified`<br/>_optional_ | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | last-modified timestamp as reported by server. |
| `contentSize`<br/>_optional_ | `number` | Resource content size. |
| `failed`<br/>_optional_ | `boolean` | True if the resource failed to load. |
| `canceled`<br/>_optional_ | `boolean` | True if the resource was canceled during loading. |


### <a name="frameresourcetree"></a>FrameResourceTree `🧪 experimental`

Information about the Frame hierarchy along with their cached resources.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `frame` | [Frame](#frame) | Frame information for this tree item. |
| `childFrames`<br/>_optional_ | array of [FrameResourceTree](#frameresourcetree) | Child frames. |
| `resources` | array of [FrameResource](#frameresource) | Information about frame resources. |


### <a name="frametree"></a>FrameTree

Information about the Frame hierarchy.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `frame` | [Frame](#frame) | Frame information for this tree item. |
| `childFrames`<br/>_optional_ | array of [FrameTree](#frametree) | Child frames. |


### <a name="scriptidentifier"></a>ScriptIdentifier

Unique script identifier.

* **Type**: `string`

### <a name="transitiontype"></a>TransitionType

Transition type.

* **Type**: `string`
* **Allowed values**: `"link"`, `"typed"`, `"address_bar"`, `"auto_bookmark"`, `"auto_subframe"`, `"manual_subframe"`, `"generated"`, `"auto_toplevel"`, `"form_submit"`, `"reload"`, `"keyword"`, `"keyword_generated"`, `"other"`

### <a name="navigationentry"></a>NavigationEntry

Navigation history entry.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `integer` | Unique id of the navigation history entry. |
| `url` | `string` | URL of the navigation history entry. |
| `userTypedURL` | `string` | URL that the user typed in the url bar. |
| `title` | `string` | Title of the navigation history entry. |
| `transitionType` | [TransitionType](#transitiontype) | Transition type. |


### <a name="screencastframemetadata"></a>ScreencastFrameMetadata `🧪 experimental`

Screencast frame metadata.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `offsetTop` | `number` | Top offset in DIP. |
| `pageScaleFactor` | `number` | Page scale factor. |
| `deviceWidth` | `number` | Device screen width in DIP. |
| `deviceHeight` | `number` | Device screen height in DIP. |
| `scrollOffsetX` | `number` | Position of horizontal scroll in CSS pixels. |
| `scrollOffsetY` | `number` | Position of vertical scroll in CSS pixels. |
| `timestamp`<br/>_optional_ | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Frame swap timestamp. |


### <a name="dialogtype"></a>DialogType

Javascript dialog type.

* **Type**: `string`
* **Allowed values**: `"alert"`, `"confirm"`, `"prompt"`, `"beforeunload"`

### <a name="appmanifesterror"></a>AppManifestError

Error while paring app manifest.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `message` | `string` | Error message. |
| `critical` | `integer` | If critical, this is a non-recoverable parse error. |
| `line` | `integer` | Error line. |
| `column` | `integer` | Error column. |


### <a name="appmanifestparsedproperties"></a>AppManifestParsedProperties `🧪 experimental`

Parsed app manifest properties.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scope` | `string` | Computed scope value |


### <a name="layoutviewport"></a>LayoutViewport

Layout viewport position and dimensions.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `pageX` | `integer` | Horizontal offset relative to the document (CSS pixels). |
| `pageY` | `integer` | Vertical offset relative to the document (CSS pixels). |
| `clientWidth` | `integer` | Width (CSS pixels), excludes scrollbar if present. |
| `clientHeight` | `integer` | Height (CSS pixels), excludes scrollbar if present. |


### <a name="visualviewport"></a>VisualViewport

Visual viewport position, dimensions, and scale.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `offsetX` | `number` | Horizontal offset relative to the layout viewport (CSS pixels). |
| `offsetY` | `number` | Vertical offset relative to the layout viewport (CSS pixels). |
| `pageX` | `number` | Horizontal offset relative to the document (CSS pixels). |
| `pageY` | `number` | Vertical offset relative to the document (CSS pixels). |
| `clientWidth` | `number` | Width (CSS pixels), excludes scrollbar if present. |
| `clientHeight` | `number` | Height (CSS pixels), excludes scrollbar if present. |
| `scale` | `number` | Scale relative to the ideal viewport (size at width=device-width). |
| `zoom`<br/>_optional_ | `number` | Page zoom factor (CSS to device independent pixels ratio). |


### <a name="viewport"></a>Viewport

Viewport for capturing screenshot.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `x` | `number` | X offset in device independent pixels (dip). |
| `y` | `number` | Y offset in device independent pixels (dip). |
| `width` | `number` | Rectangle width in device independent pixels (dip). |
| `height` | `number` | Rectangle height in device independent pixels (dip). |
| `scale` | `number` | Page scale factor. |


### <a name="fontfamilies"></a>FontFamilies `🧪 experimental`

Generic font families collection.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `standard`<br/>_optional_ | `string` | The standard font-family. |
| `fixed`<br/>_optional_ | `string` | The fixed font-family. |
| `serif`<br/>_optional_ | `string` | The serif font-family. |
| `sansSerif`<br/>_optional_ | `string` | The sansSerif font-family. |
| `cursive`<br/>_optional_ | `string` | The cursive font-family. |
| `fantasy`<br/>_optional_ | `string` | The fantasy font-family. |
| `math`<br/>_optional_ | `string` | The math font-family. |


### <a name="scriptfontfamilies"></a>ScriptFontFamilies `🧪 experimental`

Font families collection for a script.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `script` | `string` | Name of the script which these font families are defined for. |
| `fontFamilies` | [FontFamilies](#fontfamilies) | Generic font families collection for the script. |


### <a name="fontsizes"></a>FontSizes `🧪 experimental`

Default font sizes.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `standard`<br/>_optional_ | `integer` | Default standard font size. |
| `fixed`<br/>_optional_ | `integer` | Default fixed font size. |


### <a name="clientnavigationreason"></a>ClientNavigationReason `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"anchorClick"`, `"formSubmissionGet"`, `"formSubmissionPost"`, `"httpHeaderRefresh"`, `"initialFrameNavigation"`, `"metaTagRefresh"`, `"other"`, `"pageBlockInterstitial"`, `"reload"`, `"scriptInitiated"`

### <a name="clientnavigationdisposition"></a>ClientNavigationDisposition `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"currentTab"`, `"newTab"`, `"newWindow"`, `"download"`

### <a name="installabilityerrorargument"></a>InstallabilityErrorArgument `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Argument name (e.g. name:'minimum-icon-size-in-pixels'). |
| `value` | `string` | Argument value (e.g. value:'64'). |


### <a name="installabilityerror"></a>InstallabilityError `🧪 experimental`

The installability error

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `errorId` | `string` | The error id (e.g. 'manifest-missing-suitable-icon'). |
| `errorArguments` | array of [InstallabilityErrorArgument](#installabilityerrorargument) | The list of error arguments (e.g. {name:'minimum-icon-size-in-pixels', value:'64'}). |


### <a name="referrerpolicy"></a>ReferrerPolicy `🧪 experimental`

The referring-policy used for the navigation.

* **Type**: `string`
* **Allowed values**: `"noReferrer"`, `"noReferrerWhenDowngrade"`, `"origin"`, `"originWhenCrossOrigin"`, `"sameOrigin"`, `"strictOrigin"`, `"strictOriginWhenCrossOrigin"`, `"unsafeUrl"`

### <a name="compilationcacheparams"></a>CompilationCacheParams `🧪 experimental`

Per-script compilation cache parameters for `Page.produceCompilationCache`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | The URL of the script to produce a compilation cache entry for. |
| `eager`<br/>_optional_ | `boolean` | A hint to the backend whether eager compilation is recommended.<br/>(the actual compilation mode used is upon backend discretion). |


### <a name="filefilter"></a>FileFilter `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name`<br/>_optional_ | `string` |  |
| `accepts`<br/>_optional_ | array of `string` |  |


### <a name="filehandler"></a>FileHandler `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `action` | `string` |  |
| `name` | `string` |  |
| `icons`<br/>_optional_ | array of [ImageResource](#imageresource) |  |
| `accepts`<br/>_optional_ | array of [FileFilter](#filefilter) | Mimic a map, name is the key, accepts is the value. |
| `launchType` | `string` | Won't repeat the enums, using string for easy comparison. Same as the<br/>other enums below. |


### <a name="imageresource"></a>ImageResource `🧪 experimental`

The image definition used in both icon and screenshot.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | The src field in the definition, but changing to url in favor of<br/>consistency. |
| `sizes`<br/>_optional_ | `string` |  |
| `type`<br/>_optional_ | `string` |  |


### <a name="launchhandler"></a>LaunchHandler `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `clientMode` | `string` |  |


### <a name="protocolhandler"></a>ProtocolHandler `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `protocol` | `string` |  |
| `url` | `string` |  |


### <a name="relatedapplication"></a>RelatedApplication `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id`<br/>_optional_ | `string` |  |
| `url` | `string` |  |


### <a name="scopeextension"></a>ScopeExtension `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Instead of using tuple, this field always returns the serialized string<br/>for easy understanding and comparison. |
| `hasOriginWildcard` | `boolean` |  |


### <a name="screenshot"></a>Screenshot `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `image` | [ImageResource](#imageresource) |  |
| `formFactor` | `string` |  |
| `label`<br/>_optional_ | `string` |  |


### <a name="sharetarget"></a>ShareTarget `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `action` | `string` |  |
| `method` | `string` |  |
| `enctype` | `string` |  |
| `title`<br/>_optional_ | `string` | Embed the ShareTargetParams |
| `text`<br/>_optional_ | `string` |  |
| `url`<br/>_optional_ | `string` |  |
| `files`<br/>_optional_ | array of [FileFilter](#filefilter) |  |


### <a name="shortcut"></a>Shortcut `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `url` | `string` |  |


### <a name="webappmanifest"></a>WebAppManifest `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `backgroundColor`<br/>_optional_ | `string` |  |
| `description`<br/>_optional_ | `string` | The extra description provided by the manifest. |
| `dir`<br/>_optional_ | `string` |  |
| `display`<br/>_optional_ | `string` |  |
| `displayOverrides`<br/>_optional_ | array of `string` | The overrided display mode controlled by the user. |
| `fileHandlers`<br/>_optional_ | array of [FileHandler](#filehandler) | The handlers to open files. |
| `icons`<br/>_optional_ | array of [ImageResource](#imageresource) |  |
| `id`<br/>_optional_ | `string` |  |
| `lang`<br/>_optional_ | `string` |  |
| `launchHandler`<br/>_optional_ | [LaunchHandler](#launchhandler) | TODO(crbug.com/1231886): This field is non-standard and part of a Chrome<br/>experiment. See:<br/>https://github.com/WICG/web-app-launch/blob/main/launch_handler.md |
| `name`<br/>_optional_ | `string` |  |
| `orientation`<br/>_optional_ | `string` |  |
| `preferRelatedApplications`<br/>_optional_ | `boolean` |  |
| `protocolHandlers`<br/>_optional_ | array of [ProtocolHandler](#protocolhandler) | The handlers to open protocols. |
| `relatedApplications`<br/>_optional_ | array of [RelatedApplication](#relatedapplication) |  |
| `scope`<br/>_optional_ | `string` |  |
| `scopeExtensions`<br/>_optional_ | array of [ScopeExtension](#scopeextension) | Non-standard, see<br/>https://github.com/WICG/manifest-incubations/blob/gh-pages/scope_extensions-explainer.md |
| `screenshots`<br/>_optional_ | array of [Screenshot](#screenshot) | The screenshots used by chromium. |
| `shareTarget`<br/>_optional_ | [ShareTarget](#sharetarget) |  |
| `shortName`<br/>_optional_ | `string` |  |
| `shortcuts`<br/>_optional_ | array of [Shortcut](#shortcut) |  |
| `startUrl`<br/>_optional_ | `string` |  |
| `themeColor`<br/>_optional_ | `string` |  |


### <a name="navigationtype"></a>NavigationType `🧪 experimental`

The type of a frameNavigated event.

* **Type**: `string`
* **Allowed values**: `"Navigation"`, `"BackForwardCacheRestore"`

### <a name="backforwardcachenotrestoredreason"></a>BackForwardCacheNotRestoredReason `🧪 experimental`

List of not restored reasons for back-forward cache.

* **Type**: `string`
* **Allowed values**: `"NotPrimaryMainFrame"`, `"BackForwardCacheDisabled"`, `"RelatedActiveContentsExist"`, `"HTTPStatusNotOK"`, `"SchemeNotHTTPOrHTTPS"`, `"Loading"`, `"WasGrantedMediaAccess"`, `"DisableForRenderFrameHostCalled"`, `"DomainNotAllowed"`, `"HTTPMethodNotGET"`, `"SubframeIsNavigating"`, `"Timeout"`, `"CacheLimit"`, `"JavaScriptExecution"`, `"RendererProcessKilled"`, `"RendererProcessCrashed"`, `"SchedulerTrackedFeatureUsed"`, `"ConflictingBrowsingInstance"`, `"CacheFlushed"`, `"ServiceWorkerVersionActivation"`, `"SessionRestored"`, `"ServiceWorkerPostMessage"`, `"EnteredBackForwardCacheBeforeServiceWorkerHostAdded"`, `"RenderFrameHostReused_SameSite"`, `"RenderFrameHostReused_CrossSite"`, `"ServiceWorkerClaim"`, `"IgnoreEventAndEvict"`, `"HaveInnerContents"`, `"TimeoutPuttingInCache"`, `"BackForwardCacheDisabledByLowMemory"`, `"BackForwardCacheDisabledByCommandLine"`, `"NetworkRequestDatapipeDrainedAsBytesConsumer"`, `"NetworkRequestRedirected"`, `"NetworkRequestTimeout"`, `"NetworkExceedsBufferLimit"`, `"NavigationCancelledWhileRestoring"`, `"NotMostRecentNavigationEntry"`, `"BackForwardCacheDisabledForPrerender"`, `"UserAgentOverrideDiffers"`, `"ForegroundCacheLimit"`, `"ForwardCacheDisabled"`, `"BrowsingInstanceNotSwapped"`, `"BackForwardCacheDisabledForDelegate"`, `"UnloadHandlerExistsInMainFrame"`, `"UnloadHandlerExistsInSubFrame"`, `"ServiceWorkerUnregistration"`, `"CacheControlNoStore"`, `"CacheControlNoStoreCookieModified"`, `"CacheControlNoStoreHTTPOnlyCookieModified"`, `"NoResponseHead"`, `"Unknown"`, `"ActivationNavigationsDisallowedForBug1234857"`, `"ErrorDocument"`, `"FencedFramesEmbedder"`, `"CookieDisabled"`, `"HTTPAuthRequired"`, `"CookieFlushed"`, `"BroadcastChannelOnMessage"`, `"WebViewSettingsChanged"`, `"WebViewJavaScriptObjectChanged"`, `"WebViewMessageListenerInjected"`, `"WebViewSafeBrowsingAllowlistChanged"`, `"WebViewDocumentStartJavascriptChanged"`, `"WebSocket"`, `"WebTransport"`, `"WebRTC"`, `"MainResourceHasCacheControlNoStore"`, `"MainResourceHasCacheControlNoCache"`, `"SubresourceHasCacheControlNoStore"`, `"SubresourceHasCacheControlNoCache"`, `"ContainsPlugins"`, `"DocumentLoaded"`, `"OutstandingNetworkRequestOthers"`, `"RequestedMIDIPermission"`, `"RequestedAudioCapturePermission"`, `"RequestedVideoCapturePermission"`, `"RequestedBackForwardCacheBlockedSensors"`, `"RequestedBackgroundWorkPermission"`, `"BroadcastChannel"`, `"WebXR"`, `"SharedWorker"`, `"SharedWorkerMessage"`, `"SharedWorkerWithNoActiveClient"`, `"WebLocks"`, `"WebLocksContention"`, `"WebHID"`, `"WebBluetooth"`, `"WebShare"`, `"RequestedStorageAccessGrant"`, `"WebNfc"`, `"OutstandingNetworkRequestFetch"`, `"OutstandingNetworkRequestXHR"`, `"AppBanner"`, `"Printing"`, `"WebDatabase"`, `"PictureInPicture"`, `"SpeechRecognizer"`, `"IdleManager"`, `"PaymentManager"`, `"SpeechSynthesis"`, `"KeyboardLock"`, `"WebOTPService"`, `"OutstandingNetworkRequestDirectSocket"`, `"InjectedJavascript"`, `"InjectedStyleSheet"`, `"KeepaliveRequest"`, `"IndexedDBEvent"`, `"Dummy"`, `"JsNetworkRequestReceivedCacheControlNoStoreResource"`, `"WebRTCUsedWithCCNS"`, `"WebTransportUsedWithCCNS"`, `"WebSocketUsedWithCCNS"`, `"SmartCard"`, `"LiveMediaStreamTrack"`, `"UnloadHandler"`, `"ParserAborted"`, `"ContentSecurityHandler"`, `"ContentWebAuthenticationAPI"`, `"ContentFileChooser"`, `"ContentSerial"`, `"ContentFileSystemAccess"`, `"ContentMediaDevicesDispatcherHost"`, `"ContentWebBluetooth"`, `"ContentWebUSB"`, `"ContentMediaSessionService"`, `"ContentScreenReader"`, `"ContentDiscarded"`, `"EmbedderPopupBlockerTabHelper"`, `"EmbedderSafeBrowsingTriggeredPopupBlocker"`, `"EmbedderSafeBrowsingThreatDetails"`, `"EmbedderAppBannerManager"`, `"EmbedderDomDistillerViewerSource"`, `"EmbedderDomDistillerSelfDeletingRequestDelegate"`, `"EmbedderOomInterventionTabHelper"`, `"EmbedderOfflinePage"`, `"EmbedderChromePasswordManagerClientBindCredentialManager"`, `"EmbedderPermissionRequestManager"`, `"EmbedderModalDialog"`, `"EmbedderExtensions"`, `"EmbedderExtensionMessaging"`, `"EmbedderExtensionMessagingForOpenPort"`, `"EmbedderExtensionSentMessageToCachedFrame"`, `"EmbedderExtensionFrame"`, `"RequestedByWebViewClient"`, `"PostMessageByWebViewClient"`, `"CacheControlNoStoreDeviceBoundSessionTerminated"`, `"CacheLimitPrunedOnModerateMemoryPressure"`, `"CacheLimitPrunedOnCriticalMemoryPressure"`

### <a name="backforwardcachenotrestoredreasontype"></a>BackForwardCacheNotRestoredReasonType `🧪 experimental`

Types of not restored reasons for back-forward cache.

* **Type**: `string`
* **Allowed values**: `"SupportPending"`, `"PageSupportNeeded"`, `"Circumstantial"`

### <a name="backforwardcacheblockingdetails"></a>BackForwardCacheBlockingDetails `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url`<br/>_optional_ | `string` | Url of the file where blockage happened. Optional because of tests. |
| `function`<br/>_optional_ | `string` | Function name where blockage happened. Optional because of anonymous functions and tests. |
| `lineNumber` | `integer` | Line number in the script (0-based). |
| `columnNumber` | `integer` | Column number in the script (0-based). |


### <a name="backforwardcachenotrestoredexplanation"></a>BackForwardCacheNotRestoredExplanation `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | [BackForwardCacheNotRestoredReasonType](#backforwardcachenotrestoredreasontype) | Type of the reason |
| `reason` | [BackForwardCacheNotRestoredReason](#backforwardcachenotrestoredreason) | Not restored reason |
| `context`<br/>_optional_ | `string` | Context associated with the reason. The meaning of this context is<br/>dependent on the reason:<br/>- EmbedderExtensionSentMessageToCachedFrame: the extension ID. |
| `details`<br/>_optional_ | array of [BackForwardCacheBlockingDetails](#backforwardcacheblockingdetails) |  |


### <a name="backforwardcachenotrestoredexplanationtree"></a>BackForwardCacheNotRestoredExplanationTree `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | URL of each frame |
| `explanations` | array of [BackForwardCacheNotRestoredExplanation](#backforwardcachenotrestoredexplanation) | Not restored reasons of each frame |
| `children` | array of [BackForwardCacheNotRestoredExplanationTree](#backforwardcachenotrestoredexplanationtree) | Array of children frame |


---

<a name="commands"></a>
## Commands

### <a name="addscripttoevaluateonload"></a>addScriptToEvaluateOnLoad `🧪 experimental` `⚠️ deprecated`

Deprecated, please use addScriptToEvaluateOnNewDocument instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptSource` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [ScriptIdentifier](#scriptidentifier) | Identifier of the added script. |


### <a name="addscripttoevaluateonnewdocument"></a>addScriptToEvaluateOnNewDocument

Evaluates given script in every frame upon creation (before loading frame's scripts).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `source` | `string` |  |
| `worldName`<br/>_optional_ | `string` | `🧪 experimental` If specified, creates an isolated world with the given name and evaluates given script in it.<br/>This world name will be used as the ExecutionContextDescription::name when the corresponding<br/>event is emitted. |
| `includeCommandLineAPI`<br/>_optional_ | `boolean` | `🧪 experimental` Specifies whether command line API should be available to the script, defaults<br/>to false. |
| `runImmediately`<br/>_optional_ | `boolean` | `🧪 experimental` If true, runs the script immediately on existing execution contexts or worlds.<br/>Default: false. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [ScriptIdentifier](#scriptidentifier) | Identifier of the added script. |


### <a name="bringtofront"></a>bringToFront

Brings page to front (activates tab).

* **Parameters**: None

* **Returns**: None


### <a name="capturescreenshot"></a>captureScreenshot

Capture page screenshot.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `format`<br/>_optional_ | `string` | Image compression format (defaults to png).<br/>Allowed values: `"jpeg"`, `"png"`, `"webp"` |
| `quality`<br/>_optional_ | `integer` | Compression quality from range [0..100] (jpeg only). |
| `clip`<br/>_optional_ | [Viewport](#viewport) | Capture the screenshot of a given region only. |
| `fromSurface`<br/>_optional_ | `boolean` | `🧪 experimental` Capture the screenshot from the surface, rather than the view. Defaults to true. |
| `captureBeyondViewport`<br/>_optional_ | `boolean` | `🧪 experimental` Capture the screenshot beyond the viewport. Defaults to false. |
| `optimizeForSpeed`<br/>_optional_ | `boolean` | `🧪 experimental` Optimize image encoding for speed, not for resulting size (defaults to false) |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `data` | `string` | Base64-encoded image data. (Encoded as a base64 string when passed over JSON) |


### <a name="capturesnapshot"></a>captureSnapshot `🧪 experimental`

Returns a snapshot of the page as a string. For MHTML format, the serialization includes
iframes, shadow DOM, external resources, and element-inline styles.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `format`<br/>_optional_ | `string` | Format (defaults to mhtml).<br/>Allowed values: `"mhtml"` |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `data` | `string` | Serialized page data. |


### <a name="cleardevicemetricsoverride"></a>clearDeviceMetricsOverride `🧪 experimental` `⚠️ deprecated`

Clears the overridden device metrics.

* **Parameters**: None

* **Returns**: None


### <a name="cleardeviceorientationoverride"></a>clearDeviceOrientationOverride `🧪 experimental` `⚠️ deprecated`

Clears the overridden Device Orientation.

* **Parameters**: None

* **Returns**: None


### <a name="cleargeolocationoverride"></a>clearGeolocationOverride `⚠️ deprecated`

Clears the overridden Geolocation Position and Error.

* **Parameters**: None

* **Returns**: None


### <a name="createisolatedworld"></a>createIsolatedWorld

Creates an isolated world for the given frame.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame in which the isolated world should be created. |
| `worldName`<br/>_optional_ | `string` | An optional name which is reported in the Execution Context. |
| `grantUniveralAccess`<br/>_optional_ | `boolean` | Whether or not universal access should be granted to the isolated world. This is a powerful<br/>option, use with caution. |
| `contentSecurityPolicy`<br/>_optional_ | `string` | An optional content security policy to set for the isolated world.<br/>If omitted, any existing CSP for the world will be cleared.<br/>Note that clearing or updating the CSP does not immediately affect the active<br/>context in the same document because LocalDOMWindow caches the<br/>ContentSecurityPolicy object. The change takes effect on subsequent<br/>navigations when a new window context is created. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `executionContextId` | [Runtime.ExecutionContextId](Runtime.md#executioncontextid) | Execution context of the isolated world. |


### <a name="deletecookie"></a>deleteCookie `🧪 experimental` `⚠️ deprecated`

Deletes browser cookie with given name, domain and path.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `cookieName` | `string` | Name of the cookie to remove. |
| `url` | `string` | URL to match cooke domain and path. |

* **Returns**: None


### <a name="disable"></a>disable

Disables page domain notifications.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables page domain notifications.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enableFileChooserOpenedEvent`<br/>_optional_ | `boolean` | `🧪 experimental` If true, the `Page.fileChooserOpened` event will be emitted regardless of the state set by<br/>`Page.setInterceptFileChooserDialog` command (default: false). |

* **Returns**: None


### <a name="getappmanifest"></a>getAppManifest

Gets the processed manifest for this current document.
  This API always waits for the manifest to be loaded.
  If manifestId is provided, and it does not match the manifest of the
    current document, this API errors out.
  If there is not a loaded page, this API errors out immediately.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `manifestId`<br/>_optional_ | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Manifest location. |
| `errors` | array of [AppManifestError](#appmanifesterror) |  |
| `data`<br/>_optional_ | `string` | Manifest content. |
| `parsed`<br/>_optional_ | [AppManifestParsedProperties](#appmanifestparsedproperties) | `🧪 experimental` `⚠️ deprecated` Parsed manifest properties. Deprecated, use manifest instead. |
| `manifest` | [WebAppManifest](#webappmanifest) | `🧪 experimental` |


### <a name="getinstallabilityerrors"></a>getInstallabilityErrors `🧪 experimental`

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `installabilityErrors` | array of [InstallabilityError](#installabilityerror) |  |


### <a name="getmanifesticons"></a>getManifestIcons `🧪 experimental` `⚠️ deprecated`

Deprecated because it's not guaranteed that the returned icon is in fact the one used for PWA installation.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `primaryIcon`<br/>_optional_ | `string` |  |


### <a name="getappid"></a>getAppId `🧪 experimental`

Returns the unique (PWA) app id.
Only returns values if the feature flag 'WebAppEnableManifestId' is enabled

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `appId`<br/>_optional_ | `string` | App id, either from manifest's id attribute or computed from start_url |
| `recommendedId`<br/>_optional_ | `string` | Recommendation for manifest's id attribute to match current id computed from start_url |


### <a name="getadscriptancestry"></a>getAdScriptAncestry `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `adScriptAncestry`<br/>_optional_ | [Network.AdAncestry](Network.md#adancestry) | The ancestry chain of ad script identifiers leading to this frame's<br/>creation, along with the root script's filterlist rule. The ancestry<br/>chain is ordered from the most immediate script (in the frame creation<br/>stack) to more distant ancestors (that created the immediately preceding<br/>script). Only sent if frame is labelled as an ad and ids are available. |


### <a name="getframetree"></a>getFrameTree

Returns present frame tree structure.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `frameTree` | [FrameTree](#frametree) | Present frame tree structure. |


### <a name="getlayoutmetrics"></a>getLayoutMetrics

Returns metrics relating to the layouting of the page, such as viewport bounds/scale.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `layoutViewport` | [LayoutViewport](#layoutviewport) | `⚠️ deprecated` Deprecated metrics relating to the layout viewport. Is in device pixels. Use `cssLayoutViewport` instead. |
| `visualViewport` | [VisualViewport](#visualviewport) | `⚠️ deprecated` Deprecated metrics relating to the visual viewport. Is in device pixels. Use `cssVisualViewport` instead. |
| `contentSize` | [DOM.Rect](DOM.md#rect) | `⚠️ deprecated` Deprecated size of scrollable area. Is in DP. Use `cssContentSize` instead. |
| `cssLayoutViewport` | [LayoutViewport](#layoutviewport) | Metrics relating to the layout viewport in CSS pixels. |
| `cssVisualViewport` | [VisualViewport](#visualviewport) | Metrics relating to the visual viewport in CSS pixels. |
| `cssContentSize` | [DOM.Rect](DOM.md#rect) | Size of scrollable area in CSS pixels. |


### <a name="getnavigationhistory"></a>getNavigationHistory

Returns navigation history for the current page.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `currentIndex` | `integer` | Index of the current navigation history entry. |
| `entries` | array of [NavigationEntry](#navigationentry) | Array of navigation history entries. |


### <a name="resetnavigationhistory"></a>resetNavigationHistory

Resets navigation history for the current page.

* **Parameters**: None

* **Returns**: None


### <a name="getresourcecontent"></a>getResourceContent `🧪 experimental`

Returns content of the given resource.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Frame id to get resource for. |
| `url` | `string` | URL of the resource to get content for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `content` | `string` | Resource content. |
| `base64Encoded` | `boolean` | True, if content was served as base64. |


### <a name="getresourcetree"></a>getResourceTree `🧪 experimental`

Returns present frame / resource tree structure.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `frameTree` | [FrameResourceTree](#frameresourcetree) | Present frame / resource tree structure. |


### <a name="handlejavascriptdialog"></a>handleJavaScriptDialog

Accepts or dismisses a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `accept` | `boolean` | Whether to accept or dismiss the dialog. |
| `promptText`<br/>_optional_ | `string` | The text to enter into the dialog prompt before accepting. Used only if this is a prompt<br/>dialog. |

* **Returns**: None


### <a name="navigate"></a>navigate

Navigates current page to the given URL.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | URL to navigate the page to. |
| `referrer`<br/>_optional_ | `string` | Referrer URL. |
| `transitionType`<br/>_optional_ | [TransitionType](#transitiontype) | Intended transition type. |
| `frameId`<br/>_optional_ | [FrameId](#frameid) | Frame id to navigate, if not specified navigates the top frame. |
| `referrerPolicy`<br/>_optional_ | [ReferrerPolicy](#referrerpolicy) | `🧪 experimental` Referrer-policy used for the navigation. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Frame id that has navigated (or failed to navigate) |
| `loaderId`<br/>_optional_ | [Network.LoaderId](Network.md#loaderid) | Loader identifier. This is omitted in case of same-document navigation,<br/>as the previously committed loaderId would not change. |
| `errorText`<br/>_optional_ | `string` | User friendly error message, present if and only if navigation has failed. |
| `isDownload`<br/>_optional_ | `boolean` | `🧪 experimental` Whether the navigation resulted in a download. |


### <a name="navigatetohistoryentry"></a>navigateToHistoryEntry

Navigates current page to the given history entry.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `entryId` | `integer` | Unique id of the entry to navigate to. |

* **Returns**: None


### <a name="printtopdf"></a>printToPDF

Print page as PDF.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `landscape`<br/>_optional_ | `boolean` | Paper orientation. Defaults to false. |
| `displayHeaderFooter`<br/>_optional_ | `boolean` | Display header and footer. Defaults to false. |
| `printBackground`<br/>_optional_ | `boolean` | Print background graphics. Defaults to false. |
| `scale`<br/>_optional_ | `number` | Scale of the webpage rendering. Defaults to 1. |
| `paperWidth`<br/>_optional_ | `number` | Paper width in inches. Defaults to 8.5 inches. |
| `paperHeight`<br/>_optional_ | `number` | Paper height in inches. Defaults to 11 inches. |
| `marginTop`<br/>_optional_ | `number` | Top margin in inches. Defaults to 1cm (~0.4 inches). |
| `marginBottom`<br/>_optional_ | `number` | Bottom margin in inches. Defaults to 1cm (~0.4 inches). |
| `marginLeft`<br/>_optional_ | `number` | Left margin in inches. Defaults to 1cm (~0.4 inches). |
| `marginRight`<br/>_optional_ | `number` | Right margin in inches. Defaults to 1cm (~0.4 inches). |
| `pageRanges`<br/>_optional_ | `string` | Paper ranges to print, one based, e.g., '1-5, 8, 11-13'. Pages are<br/>printed in the document order, not in the order specified, and no<br/>more than once.<br/>Defaults to empty string, which implies the entire document is printed.<br/>The page numbers are quietly capped to actual page count of the<br/>document, and ranges beyond the end of the document are ignored.<br/>If this results in no pages to print, an error is reported.<br/>It is an error to specify a range with start greater than end. |
| `headerTemplate`<br/>_optional_ | `string` | HTML template for the print header. Should be valid HTML markup with following<br/>classes used to inject printing values into them:<br/>- `date`: formatted print date<br/>- `title`: document title<br/>- `url`: document location<br/>- `pageNumber`: current page number<br/>- `totalPages`: total pages in the document<br/><br/>For example, `<span class=title></span>` would generate span containing the title. |
| `footerTemplate`<br/>_optional_ | `string` | HTML template for the print footer. Should use the same format as the `headerTemplate`. |
| `preferCSSPageSize`<br/>_optional_ | `boolean` | Whether or not to prefer page size as defined by css. Defaults to false,<br/>in which case the content will be scaled to fit the paper size. |
| `transferMode`<br/>_optional_ | `string` | `🧪 experimental` return as stream<br/>Allowed values: `"ReturnAsBase64"`, `"ReturnAsStream"` |
| `generateTaggedPDF`<br/>_optional_ | `boolean` | `🧪 experimental` Whether or not to generate tagged (accessible) PDF. Defaults to embedder choice. |
| `generateDocumentOutline`<br/>_optional_ | `boolean` | `🧪 experimental` Whether or not to embed the document outline into the PDF. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `data` | `string` | Base64-encoded pdf data. Empty if \|returnAsStream\| is specified. (Encoded as a base64 string when passed over JSON) |
| `stream`<br/>_optional_ | [IO.StreamHandle](IO.md#streamhandle) | `🧪 experimental` A handle of the stream that holds resulting PDF data. |


### <a name="reload"></a>reload

Reloads given page optionally ignoring the cache.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ignoreCache`<br/>_optional_ | `boolean` | If true, browser cache is ignored (as if the user pressed Shift+refresh). |
| `scriptToEvaluateOnLoad`<br/>_optional_ | `string` | If set, the script will be injected into all frames of the inspected page after reload.<br/>Argument will be ignored if reloading dataURL origin. |
| `loaderId`<br/>_optional_ | [Network.LoaderId](Network.md#loaderid) | `🧪 experimental` If set, an error will be thrown if the target page's main frame's<br/>loader id does not match the provided id. This prevents accidentally<br/>reloading an unintended target in case there's a racing navigation. |

* **Returns**: None


### <a name="removescripttoevaluateonload"></a>removeScriptToEvaluateOnLoad `🧪 experimental` `⚠️ deprecated`

Deprecated, please use removeScriptToEvaluateOnNewDocument instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [ScriptIdentifier](#scriptidentifier) |  |

* **Returns**: None


### <a name="removescripttoevaluateonnewdocument"></a>removeScriptToEvaluateOnNewDocument

Removes given script from the list.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [ScriptIdentifier](#scriptidentifier) |  |

* **Returns**: None


### <a name="screencastframeack"></a>screencastFrameAck `🧪 experimental`

Acknowledges that a screencast frame has been received by the frontend.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sessionId` | `integer` | Frame number. |

* **Returns**: None


### <a name="searchinresource"></a>searchInResource `🧪 experimental`

Searches for given string in resource content.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Frame id for resource to search in. |
| `url` | `string` | URL of the resource to search in. |
| `query` | `string` | String to search for. |
| `caseSensitive`<br/>_optional_ | `boolean` | If true, search is case sensitive. |
| `isRegex`<br/>_optional_ | `boolean` | If true, treats string parameter as regex. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | array of [Debugger.SearchMatch](Debugger.md#searchmatch) | List of search matches. |


### <a name="setadblockingenabled"></a>setAdBlockingEnabled `🧪 experimental`

Enable Chrome's experimental ad filter on all sites.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether to block ads. |

* **Returns**: None


### <a name="setbypasscsp"></a>setBypassCSP

Enable page Content Security Policy by-passing.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether to bypass page CSP. |

* **Returns**: None


### <a name="getpermissionspolicystate"></a>getPermissionsPolicyState `🧪 experimental`

Get Permissions Policy state on given frame.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `states` | array of [PermissionsPolicyFeatureState](#permissionspolicyfeaturestate) |  |


### <a name="getorigintrials"></a>getOriginTrials `🧪 experimental`

Get Origin Trials on given frame.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `originTrials` | array of [OriginTrial](#origintrial) |  |


### <a name="setdevicemetricsoverride"></a>setDeviceMetricsOverride `🧪 experimental` `⚠️ deprecated`

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
| `scale`<br/>_optional_ | `number` | Scale to apply to resulting view image. |
| `screenWidth`<br/>_optional_ | `integer` | Overriding screen width value in pixels (minimum 0, maximum 10000000). |
| `screenHeight`<br/>_optional_ | `integer` | Overriding screen height value in pixels (minimum 0, maximum 10000000). |
| `positionX`<br/>_optional_ | `integer` | Overriding view X position on screen in pixels (minimum 0, maximum 10000000). |
| `positionY`<br/>_optional_ | `integer` | Overriding view Y position on screen in pixels (minimum 0, maximum 10000000). |
| `dontSetVisibleSize`<br/>_optional_ | `boolean` | Do not set visible view size, rely upon explicit setVisibleSize call. |
| `screenOrientation`<br/>_optional_ | [Emulation.ScreenOrientation](Emulation.md#screenorientation) | Screen orientation override. |
| `viewport`<br/>_optional_ | [Viewport](#viewport) | The viewport dimensions and scale. If not set, the override is cleared. |

* **Returns**: None


### <a name="setdeviceorientationoverride"></a>setDeviceOrientationOverride `🧪 experimental` `⚠️ deprecated`

Overrides the Device Orientation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `alpha` | `number` | Mock alpha |
| `beta` | `number` | Mock beta |
| `gamma` | `number` | Mock gamma |

* **Returns**: None


### <a name="setfontfamilies"></a>setFontFamilies `🧪 experimental`

Set generic font families.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `fontFamilies` | [FontFamilies](#fontfamilies) | Specifies font families to set. If a font family is not specified, it won't be changed. |
| `forScripts`<br/>_optional_ | array of [ScriptFontFamilies](#scriptfontfamilies) | Specifies font families to set for individual scripts. |

* **Returns**: None


### <a name="setfontsizes"></a>setFontSizes `🧪 experimental`

Set default font sizes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `fontSizes` | [FontSizes](#fontsizes) | Specifies font sizes to set. If a font size is not specified, it won't be changed. |

* **Returns**: None


### <a name="setdocumentcontent"></a>setDocumentContent

Sets given markup as the document's HTML.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Frame id to set HTML for. |
| `html` | `string` | HTML content to set. |

* **Returns**: None


### <a name="setdownloadbehavior"></a>setDownloadBehavior `🧪 experimental` `⚠️ deprecated`

Set the behavior when downloading a file.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `behavior` | `string` | Whether to allow all or deny all download requests, or use default Chrome behavior if<br/>available (otherwise deny).<br/>Allowed values: `"deny"`, `"allow"`, `"default"` |
| `downloadPath`<br/>_optional_ | `string` | The default path to save downloaded files to. This is required if behavior is set to 'allow' |

* **Returns**: None


### <a name="setgeolocationoverride"></a>setGeolocationOverride `⚠️ deprecated`

Overrides the Geolocation Position or Error. Omitting any of the parameters emulates position
unavailable.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `latitude`<br/>_optional_ | `number` | Mock latitude |
| `longitude`<br/>_optional_ | `number` | Mock longitude |
| `accuracy`<br/>_optional_ | `number` | Mock accuracy |

* **Returns**: None


### <a name="setlifecycleeventsenabled"></a>setLifecycleEventsEnabled

Controls whether page will emit lifecycle events.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | If true, starts emitting lifecycle events. |

* **Returns**: None


### <a name="settouchemulationenabled"></a>setTouchEmulationEnabled `🧪 experimental` `⚠️ deprecated`

Toggles mouse event-based touch event emulation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether the touch event emulation should be enabled. |
| `configuration`<br/>_optional_ | `string` | Touch/gesture events configuration. Default: current platform.<br/>Allowed values: `"mobile"`, `"desktop"` |

* **Returns**: None


### <a name="startscreencast"></a>startScreencast `🧪 experimental`

Starts sending each frame using the `screencastFrame` event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `format`<br/>_optional_ | `string` | Image compression format.<br/>Allowed values: `"jpeg"`, `"png"` |
| `quality`<br/>_optional_ | `integer` | Compression quality from range [0..100]. |
| `maxWidth`<br/>_optional_ | `integer` | Maximum screenshot width. |
| `maxHeight`<br/>_optional_ | `integer` | Maximum screenshot height. |
| `everyNthFrame`<br/>_optional_ | `integer` | Send every n-th frame. |

* **Returns**: None


### <a name="stoploading"></a>stopLoading

Force the page stop all navigations and pending resource fetches.

* **Parameters**: None

* **Returns**: None


### <a name="crash"></a>crash `🧪 experimental`

Crashes renderer on the IO thread, generates minidumps.

* **Parameters**: None

* **Returns**: None


### <a name="close"></a>close

Tries to close page, running its beforeunload hooks, if any.

* **Parameters**: None

* **Returns**: None


### <a name="setweblifecyclestate"></a>setWebLifecycleState `🧪 experimental`

Tries to update the web lifecycle state of the page.
It will transition the page to the given state according to:
https://github.com/WICG/web-lifecycle/

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `state` | `string` | Target lifecycle state<br/>Allowed values: `"frozen"`, `"active"` |

* **Returns**: None


### <a name="stopscreencast"></a>stopScreencast `🧪 experimental`

Stops sending each frame in the `screencastFrame`.

* **Parameters**: None

* **Returns**: None


### <a name="producecompilationcache"></a>produceCompilationCache `🧪 experimental`

Requests backend to produce compilation cache for the specified scripts.
`scripts` are appended to the list of scripts for which the cache
would be produced. The list may be reset during page navigation.
When script with a matching URL is encountered, the cache is optionally
produced upon backend discretion, based on internal heuristics.
See also: `Page.compilationCacheProduced`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scripts` | array of [CompilationCacheParams](#compilationcacheparams) |  |

* **Returns**: None


### <a name="addcompilationcache"></a>addCompilationCache `🧪 experimental`

Seeds compilation cache for given url. Compilation cache does not survive
cross-process navigation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` |  |
| `data` | `string` | Base64-encoded data (Encoded as a base64 string when passed over JSON) |

* **Returns**: None


### <a name="clearcompilationcache"></a>clearCompilationCache `🧪 experimental`

Clears seeded compilation cache.

* **Parameters**: None

* **Returns**: None


### <a name="setspctransactionmode"></a>setSPCTransactionMode `🧪 experimental`

Sets the Secure Payment Confirmation transaction mode.
https://w3c.github.io/secure-payment-confirmation/#sctn-automation-set-spc-transaction-mode

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `mode` | `string` | Allowed values: `"none"`, `"autoAccept"`, `"autoChooseToAuthAnotherWay"`, `"autoReject"`, `"autoOptOut"` |

* **Returns**: None


### <a name="setrphregistrationmode"></a>setRPHRegistrationMode `🧪 experimental`

Extensions for Custom Handlers API:
https://html.spec.whatwg.org/multipage/system-state.html#rph-automation

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `mode` | `string` | Allowed values: `"none"`, `"autoAccept"`, `"autoReject"` |

* **Returns**: None


### <a name="generatetestreport"></a>generateTestReport `🧪 experimental`

Generates a report for testing.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `message` | `string` | Message to be displayed in the report. |
| `group`<br/>_optional_ | `string` | Specifies the endpoint group to deliver the report to. |

* **Returns**: None


### <a name="waitfordebugger"></a>waitForDebugger `🧪 experimental`

Pauses page execution. Can be resumed using generic Runtime.runIfWaitingForDebugger.

* **Parameters**: None

* **Returns**: None


### <a name="setinterceptfilechooserdialog"></a>setInterceptFileChooserDialog

Intercept file chooser requests and transfer control to protocol clients.
When file chooser interception is enabled, native file chooser dialog is not shown.
Instead, a protocol event `Page.fileChooserOpened` is emitted.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` |  |
| `cancel`<br/>_optional_ | `boolean` | `🧪 experimental` If true, cancels the dialog by emitting relevant events (if any)<br/>in addition to not showing it if the interception is enabled<br/>(default: false). |

* **Returns**: None


### <a name="setprerenderingallowed"></a>setPrerenderingAllowed `🧪 experimental`

Enable/disable prerendering manually.

This command is a short-term solution for https://crbug.com/1440085.
See https://docs.google.com/document/d/12HVmFxYj5Jc-eJr5OmWsa2bqTJsbgGLKI6ZIyx0_wpA
for more details.

TODO(https://crbug.com/1440085): Remove this once Puppeteer supports tab targets.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `isAllowed` | `boolean` |  |

* **Returns**: None


### <a name="getannotatedpagecontent"></a>getAnnotatedPageContent `🧪 experimental`

Get the annotated page content for the main frame.
This is an experimental command that is subject to change.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `includeActionableInformation`<br/>_optional_ | `boolean` | Whether to include actionable information. Defaults to true. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `content` | `string` | The annotated page content as a base64 encoded protobuf.<br/>The format is defined by the `AnnotatedPageContent` message in<br/>components/optimization_guide/proto/features/common_quality_data.proto (Encoded as a base64 string when passed over JSON) |


---

<a name="events"></a>
## Events

### <a name="domcontenteventfired"></a>domContentEventFired

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `timestamp` | [Network.MonotonicTime](Network.md#monotonictime) |  |


### <a name="filechooseropened"></a>fileChooserOpened

Emitted only when `page.interceptFileChooser` is enabled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | `🧪 experimental` Id of the frame containing input node. |
| `mode` | `string` | Input mode.<br/>Allowed values: `"selectSingle"`, `"selectMultiple"` |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | `🧪 experimental` Input node id. Only present for file choosers opened via an `<input type="file">` element. |


### <a name="frameattached"></a>frameAttached

Fired when frame has been attached to its parent.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that has been attached. |
| `parentFrameId` | [FrameId](#frameid) | Parent frame identifier. |
| `stack`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | JavaScript stack trace of when frame was attached, only set if frame initiated from script. |


### <a name="frameclearedschedulednavigation"></a>frameClearedScheduledNavigation `⚠️ deprecated`

Fired when frame no longer has a scheduled navigation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that has cleared its scheduled navigation. |


### <a name="framedetached"></a>frameDetached

Fired when frame has been detached from its parent.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that has been detached. |
| `reason` | `string` | `🧪 experimental`<br/>Allowed values: `"remove"`, `"swap"` |


### <a name="framesubtreewillbedetached"></a>frameSubtreeWillBeDetached `🧪 experimental`

Fired before frame subtree is detached. Emitted before any frame of the
subtree is actually detached.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that is the root of the subtree that will be detached. |


### <a name="framenavigated"></a>frameNavigated

Fired once navigation of the frame has completed. Frame is now associated with the new loader.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frame` | [Frame](#frame) | Frame object. |
| `type` | [NavigationType](#navigationtype) | `🧪 experimental` |


### <a name="documentopened"></a>documentOpened `🧪 experimental`

Fired when opening document to write to.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frame` | [Frame](#frame) | Frame object. |


### <a name="frameresized"></a>frameResized `🧪 experimental`

* **Parameters**: None


### <a name="framestartednavigating"></a>frameStartedNavigating `🧪 experimental`

Fired when a navigation starts. This event is fired for both
renderer-initiated and browser-initiated navigations. For renderer-initiated
navigations, the event is fired after `frameRequestedNavigation`.
Navigation may still be cancelled after the event is issued. Multiple events
can be fired for a single navigation, for example, when a same-document
navigation becomes a cross-document navigation (such as in the case of a
frameset).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | ID of the frame that is being navigated. |
| `url` | `string` | The URL the navigation started with. The final URL can be different. |
| `loaderId` | [Network.LoaderId](Network.md#loaderid) | Loader identifier. Even though it is present in case of same-document<br/>navigation, the previously committed loaderId would not change unless<br/>the navigation changes from a same-document to a cross-document<br/>navigation. |
| `navigationType` | `string` | Allowed values: `"reload"`, `"reloadBypassingCache"`, `"restore"`, `"restoreWithPost"`, `"historySameDocument"`, `"historyDifferentDocument"`, `"sameDocument"`, `"differentDocument"` |


### <a name="framerequestednavigation"></a>frameRequestedNavigation `🧪 experimental`

Fired when a renderer-initiated navigation is requested.
Navigation may still be cancelled after the event is issued.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that is being navigated. |
| `reason` | [ClientNavigationReason](#clientnavigationreason) | The reason for the navigation. |
| `url` | `string` | The destination URL for the requested navigation. |
| `disposition` | [ClientNavigationDisposition](#clientnavigationdisposition) | The disposition for the navigation. |


### <a name="frameschedulednavigation"></a>frameScheduledNavigation `⚠️ deprecated`

Fired when frame schedules a potential navigation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that has scheduled a navigation. |
| `delay` | `number` | Delay (in seconds) until the navigation is scheduled to begin. The navigation is not<br/>guaranteed to start. |
| `reason` | [ClientNavigationReason](#clientnavigationreason) | The reason for the navigation. |
| `url` | `string` | The destination URL for the scheduled navigation. |


### <a name="framestartedloading"></a>frameStartedLoading `🧪 experimental`

Fired when frame has started loading.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that has started loading. |


### <a name="framestoppedloading"></a>frameStoppedLoading `🧪 experimental`

Fired when frame has stopped loading.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that has stopped loading. |


### <a name="downloadwillbegin"></a>downloadWillBegin `🧪 experimental` `⚠️ deprecated`

Fired when page is about to start a download.
Deprecated. Use Browser.downloadWillBegin instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame that caused download to begin. |
| `guid` | `string` | Global unique identifier of the download. |
| `url` | `string` | URL of the resource being downloaded. |
| `suggestedFilename` | `string` | Suggested file name of the resource (the actual name of the file saved on disk may differ). |


### <a name="downloadprogress"></a>downloadProgress `🧪 experimental` `⚠️ deprecated`

Fired when download makes progress. Last call has |done| == true.
Deprecated. Use Browser.downloadProgress instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `guid` | `string` | Global unique identifier of the download. |
| `totalBytes` | `number` | Total expected bytes to download. |
| `receivedBytes` | `number` | Total bytes received. |
| `state` | `string` | Download status.<br/>Allowed values: `"inProgress"`, `"completed"`, `"canceled"` |


### <a name="interstitialhidden"></a>interstitialHidden

Fired when interstitial page was hidden

* **Parameters**: None


### <a name="interstitialshown"></a>interstitialShown

Fired when interstitial page was shown

* **Parameters**: None


### <a name="javascriptdialogclosed"></a>javascriptDialogClosed

Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) has been
closed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | `🧪 experimental` Frame id. |
| `result` | `boolean` | Whether dialog was confirmed. |
| `userInput` | `string` | User input in case of prompt. |


### <a name="javascriptdialogopening"></a>javascriptDialogOpening

Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) is about to
open.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Frame url. |
| `frameId` | [FrameId](#frameid) | `🧪 experimental` Frame id. |
| `message` | `string` | Message that will be displayed by the dialog. |
| `type` | [DialogType](#dialogtype) | Dialog type. |
| `hasBrowserHandler` | `boolean` | True iff browser is capable showing or acting on the given dialog. When browser has no<br/>dialog handler for given target, calling alert while Page domain is engaged will stall<br/>the page execution. Execution can be resumed via calling Page.handleJavaScriptDialog. |
| `defaultPrompt`<br/>_optional_ | `string` | Default dialog prompt. |


### <a name="lifecycleevent"></a>lifecycleEvent

Fired for lifecycle events (navigation, load, paint, etc) in the current
target (including local frames).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame. |
| `loaderId` | [Network.LoaderId](Network.md#loaderid) | Loader identifier. Empty string if the request is fetched from worker. |
| `name` | `string` |  |
| `timestamp` | [Network.MonotonicTime](Network.md#monotonictime) |  |


### <a name="backforwardcachenotused"></a>backForwardCacheNotUsed `🧪 experimental`

Fired for failed bfcache history navigations if BackForwardCache feature is enabled. Do
not assume any ordering with the Page.frameNavigated event. This event is fired only for
main-frame history navigation where the document changes (non-same-document navigations),
when bfcache navigation fails.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `loaderId` | [Network.LoaderId](Network.md#loaderid) | The loader id for the associated navigation. |
| `frameId` | [FrameId](#frameid) | The frame id of the associated frame. |
| `notRestoredExplanations` | array of [BackForwardCacheNotRestoredExplanation](#backforwardcachenotrestoredexplanation) | Array of reasons why the page could not be cached. This must not be empty. |
| `notRestoredExplanationsTree`<br/>_optional_ | [BackForwardCacheNotRestoredExplanationTree](#backforwardcachenotrestoredexplanationtree) | Tree structure of reasons why the page could not be cached for each frame. |


### <a name="loadeventfired"></a>loadEventFired

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `timestamp` | [Network.MonotonicTime](Network.md#monotonictime) |  |


### <a name="navigatedwithindocument"></a>navigatedWithinDocument `🧪 experimental`

Fired when same-document navigation happens, e.g. due to history API usage or anchor navigation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [FrameId](#frameid) | Id of the frame. |
| `url` | `string` | Frame's new url. |
| `navigationType` | `string` | Navigation type<br/>Allowed values: `"fragment"`, `"historyApi"`, `"other"` |


### <a name="screencastframe"></a>screencastFrame `🧪 experimental`

Compressed image data requested by the `startScreencast`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `data` | `string` | Base64-encoded compressed image. (Encoded as a base64 string when passed over JSON) |
| `metadata` | [ScreencastFrameMetadata](#screencastframemetadata) | Screencast frame metadata. |
| `sessionId` | `integer` | Frame number. |


### <a name="screencastvisibilitychanged"></a>screencastVisibilityChanged `🧪 experimental`

Fired when the page with currently enabled screencast was shown or hidden `.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `visible` | `boolean` | True if the page is visible. |


### <a name="windowopen"></a>windowOpen

Fired when a new window is going to be opened, via window.open(), link click, form submission,
etc.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | The URL for the new window. |
| `windowName` | `string` | Window name. |
| `windowFeatures` | array of `string` | An array of enabled window features. |
| `userGesture` | `boolean` | Whether or not it was triggered by user gesture. |


### <a name="compilationcacheproduced"></a>compilationCacheProduced `🧪 experimental`

Issued for every compilation cache generated.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` |  |
| `data` | `string` | Base64-encoded data (Encoded as a base64 string when passed over JSON) |


