# Audits

`🧪 Experimental`

Audits domain allows investigation of page violations and possible improvements.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Network](Network.md), [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="affectedcookie"></a>AffectedCookie

Information about a cookie that is affected by an inspector issue.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | The following three properties uniquely identify a cookie |
| `path` | `string` |  |
| `domain` | `string` |  |


### <a name="affectedrequest"></a>AffectedRequest

Information about a request that is affected by an inspector issue.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId`<br/>_optional_ | [Network.RequestId](Network.md#requestid) | The unique request id. |
| `url` | `string` |  |


### <a name="affectedframe"></a>AffectedFrame

Information about the frame affected by an inspector issue.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) |  |


### <a name="cookieexclusionreason"></a>CookieExclusionReason

* **Type**: `string`
* **Allowed values**: `"ExcludeSameSiteUnspecifiedTreatedAsLax"`, `"ExcludeSameSiteNoneInsecure"`, `"ExcludeSameSiteLax"`, `"ExcludeSameSiteStrict"`, `"ExcludeDomainNonASCII"`, `"ExcludeThirdPartyCookieBlockedInFirstPartySet"`, `"ExcludeThirdPartyPhaseout"`, `"ExcludePortMismatch"`, `"ExcludeSchemeMismatch"`

### <a name="cookiewarningreason"></a>CookieWarningReason

* **Type**: `string`
* **Allowed values**: `"WarnSameSiteUnspecifiedCrossSiteContext"`, `"WarnSameSiteNoneInsecure"`, `"WarnSameSiteUnspecifiedLaxAllowUnsafe"`, `"WarnSameSiteStrictLaxDowngradeStrict"`, `"WarnSameSiteStrictCrossDowngradeStrict"`, `"WarnSameSiteStrictCrossDowngradeLax"`, `"WarnSameSiteLaxCrossDowngradeStrict"`, `"WarnSameSiteLaxCrossDowngradeLax"`, `"WarnAttributeValueExceedsMaxSize"`, `"WarnDomainNonASCII"`, `"WarnThirdPartyPhaseout"`, `"WarnCrossSiteRedirectDowngradeChangesInclusion"`, `"WarnDeprecationTrialMetadata"`, `"WarnThirdPartyCookieHeuristic"`

### <a name="cookieoperation"></a>CookieOperation

* **Type**: `string`
* **Allowed values**: `"SetCookie"`, `"ReadCookie"`

### <a name="insighttype"></a>InsightType

Represents the category of insight that a cookie issue falls under.

* **Type**: `string`
* **Allowed values**: `"GitHubResource"`, `"GracePeriod"`, `"Heuristics"`

### <a name="cookieissueinsight"></a>CookieIssueInsight

Information about the suggested solution to a cookie issue.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | [InsightType](#insighttype) |  |
| `tableEntryUrl`<br/>_optional_ | `string` | Link to table entry in third-party cookie migration readiness list. |


### <a name="cookieissuedetails"></a>CookieIssueDetails

This information is currently necessary, as the front-end has a difficult
time finding a specific cookie. With this, we can convey specific error
information without the cookie.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `cookie`<br/>_optional_ | [AffectedCookie](#affectedcookie) | If AffectedCookie is not set then rawCookieLine contains the raw<br/>Set-Cookie header string. This hints at a problem where the<br/>cookie line is syntactically or semantically malformed in a way<br/>that no valid cookie could be created. |
| `rawCookieLine`<br/>_optional_ | `string` |  |
| `cookieWarningReasons` | array of [CookieWarningReason](#cookiewarningreason) |  |
| `cookieExclusionReasons` | array of [CookieExclusionReason](#cookieexclusionreason) |  |
| `operation` | [CookieOperation](#cookieoperation) | Optionally identifies the site-for-cookies and the cookie url, which<br/>may be used by the front-end as additional context. |
| `siteForCookies`<br/>_optional_ | `string` |  |
| `cookieUrl`<br/>_optional_ | `string` |  |
| `request`<br/>_optional_ | [AffectedRequest](#affectedrequest) |  |
| `insight`<br/>_optional_ | [CookieIssueInsight](#cookieissueinsight) | The recommended solution to the issue. |


### <a name="performanceissuetype"></a>PerformanceIssueType

* **Type**: `string`
* **Allowed values**: `"DocumentCookie"`

### <a name="performanceissuedetails"></a>PerformanceIssueDetails

Details for a performance issue.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `performanceIssueType` | [PerformanceIssueType](#performanceissuetype) |  |
| `sourceCodeLocation`<br/>_optional_ | [SourceCodeLocation](#sourcecodelocation) |  |


### <a name="mixedcontentresolutionstatus"></a>MixedContentResolutionStatus

* **Type**: `string`
* **Allowed values**: `"MixedContentBlocked"`, `"MixedContentAutomaticallyUpgraded"`, `"MixedContentWarning"`

### <a name="mixedcontentresourcetype"></a>MixedContentResourceType

* **Type**: `string`
* **Allowed values**: `"AttributionSrc"`, `"Audio"`, `"Beacon"`, `"CSPReport"`, `"Download"`, `"EventSource"`, `"Favicon"`, `"Font"`, `"Form"`, `"Frame"`, `"Image"`, `"Import"`, `"JSON"`, `"Manifest"`, `"Ping"`, `"PluginData"`, `"PluginResource"`, `"Prefetch"`, `"Resource"`, `"Script"`, `"ServiceWorker"`, `"SharedWorker"`, `"SpeculationRules"`, `"Stylesheet"`, `"Track"`, `"Video"`, `"Worker"`, `"XMLHttpRequest"`, `"XSLT"`

### <a name="mixedcontentissuedetails"></a>MixedContentIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `resourceType`<br/>_optional_ | [MixedContentResourceType](#mixedcontentresourcetype) | The type of resource causing the mixed content issue (css, js, iframe,<br/>form,...). Marked as optional because it is mapped to from<br/>blink::mojom::RequestContextType, which will be replaced<br/>by network::mojom::RequestDestination |
| `resolutionStatus` | [MixedContentResolutionStatus](#mixedcontentresolutionstatus) | The way the mixed content issue is being resolved. |
| `insecureURL` | `string` | The unsafe http url causing the mixed content issue. |
| `mainResourceURL` | `string` | The url responsible for the call to an unsafe url. |
| `request`<br/>_optional_ | [AffectedRequest](#affectedrequest) | The mixed content request.<br/>Does not always exist (e.g. for unsafe form submission urls). |
| `frame`<br/>_optional_ | [AffectedFrame](#affectedframe) | Optional because not every mixed content issue is necessarily linked to a frame. |


### <a name="blockedbyresponsereason"></a>BlockedByResponseReason

Enum indicating the reason a response has been blocked. These reasons are
refinements of the net error BLOCKED_BY_RESPONSE.

* **Type**: `string`
* **Allowed values**: `"CoepFrameResourceNeedsCoepHeader"`, `"CoopSandboxedIFrameCannotNavigateToCoopPage"`, `"CorpNotSameOrigin"`, `"CorpNotSameOriginAfterDefaultedToSameOriginByCoep"`, `"CorpNotSameOriginAfterDefaultedToSameOriginByDip"`, `"CorpNotSameOriginAfterDefaultedToSameOriginByCoepAndDip"`, `"CorpNotSameSite"`, `"SRIMessageSignatureMismatch"`

### <a name="blockedbyresponseissuedetails"></a>BlockedByResponseIssueDetails

Details for a request that has been blocked with the BLOCKED_BY_RESPONSE
code. Currently only used for COEP/COOP, but may be extended to include
some CSP errors in the future.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `request` | [AffectedRequest](#affectedrequest) |  |
| `parentFrame`<br/>_optional_ | [AffectedFrame](#affectedframe) |  |
| `blockedFrame`<br/>_optional_ | [AffectedFrame](#affectedframe) |  |
| `reason` | [BlockedByResponseReason](#blockedbyresponsereason) |  |


### <a name="heavyadresolutionstatus"></a>HeavyAdResolutionStatus

* **Type**: `string`
* **Allowed values**: `"HeavyAdBlocked"`, `"HeavyAdWarning"`

### <a name="heavyadreason"></a>HeavyAdReason

* **Type**: `string`
* **Allowed values**: `"NetworkTotalLimit"`, `"CpuTotalLimit"`, `"CpuPeakLimit"`

### <a name="heavyadissuedetails"></a>HeavyAdIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `resolution` | [HeavyAdResolutionStatus](#heavyadresolutionstatus) | The resolution status, either blocking the content or warning. |
| `reason` | [HeavyAdReason](#heavyadreason) | The reason the ad was blocked, total network or cpu or peak cpu. |
| `frame` | [AffectedFrame](#affectedframe) | The frame that was blocked. |


### <a name="contentsecuritypolicyviolationtype"></a>ContentSecurityPolicyViolationType

* **Type**: `string`
* **Allowed values**: `"kInlineViolation"`, `"kEvalViolation"`, `"kURLViolation"`, `"kSRIViolation"`, `"kTrustedTypesSinkViolation"`, `"kTrustedTypesPolicyViolation"`, `"kWasmEvalViolation"`

### <a name="sourcecodelocation"></a>SourceCodeLocation

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId`<br/>_optional_ | [Runtime.ScriptId](Runtime.md#scriptid) |  |
| `url` | `string` |  |
| `lineNumber` | `integer` |  |
| `columnNumber` | `integer` |  |


### <a name="contentsecuritypolicyissuedetails"></a>ContentSecurityPolicyIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `blockedURL`<br/>_optional_ | `string` | The url not included in allowed sources. |
| `violatedDirective` | `string` | Specific directive that is violated, causing the CSP issue. |
| `isReportOnly` | `boolean` |  |
| `contentSecurityPolicyViolationType` | [ContentSecurityPolicyViolationType](#contentsecuritypolicyviolationtype) |  |
| `frameAncestor`<br/>_optional_ | [AffectedFrame](#affectedframe) |  |
| `sourceCodeLocation`<br/>_optional_ | [SourceCodeLocation](#sourcecodelocation) |  |
| `violatingNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) |  |


### <a name="sharedarraybufferissuetype"></a>SharedArrayBufferIssueType

* **Type**: `string`
* **Allowed values**: `"TransferIssue"`, `"CreationIssue"`

### <a name="sharedarraybufferissuedetails"></a>SharedArrayBufferIssueDetails

Details for a issue arising from an SAB being instantiated in, or
transferred to a context that is not cross-origin isolated.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `sourceCodeLocation` | [SourceCodeLocation](#sourcecodelocation) |  |
| `isWarning` | `boolean` |  |
| `type` | [SharedArrayBufferIssueType](#sharedarraybufferissuetype) |  |


### <a name="corsissuedetails"></a>CorsIssueDetails

Details for a CORS related issue, e.g. a warning or error related to
CORS RFC1918 enforcement.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `corsErrorStatus` | [Network.CorsErrorStatus](Network.md#corserrorstatus) |  |
| `isWarning` | `boolean` |  |
| `request` | [AffectedRequest](#affectedrequest) |  |
| `location`<br/>_optional_ | [SourceCodeLocation](#sourcecodelocation) |  |
| `initiatorOrigin`<br/>_optional_ | `string` |  |
| `resourceIPAddressSpace`<br/>_optional_ | [Network.IPAddressSpace](Network.md#ipaddressspace) |  |
| `clientSecurityState`<br/>_optional_ | [Network.ClientSecurityState](Network.md#clientsecuritystate) |  |


### <a name="attributionreportingissuetype"></a>AttributionReportingIssueType

* **Type**: `string`
* **Allowed values**: `"PermissionPolicyDisabled"`, `"UntrustworthyReportingOrigin"`, `"InsecureContext"`, `"InvalidHeader"`, `"InvalidRegisterTriggerHeader"`, `"SourceAndTriggerHeaders"`, `"SourceIgnored"`, `"TriggerIgnored"`, `"OsSourceIgnored"`, `"OsTriggerIgnored"`, `"InvalidRegisterOsSourceHeader"`, `"InvalidRegisterOsTriggerHeader"`, `"WebAndOsHeaders"`, `"NoWebOrOsSupport"`, `"NavigationRegistrationWithoutTransientUserActivation"`, `"InvalidInfoHeader"`, `"NoRegisterSourceHeader"`, `"NoRegisterTriggerHeader"`, `"NoRegisterOsSourceHeader"`, `"NoRegisterOsTriggerHeader"`, `"NavigationRegistrationUniqueScopeAlreadySet"`

### <a name="shareddictionaryerror"></a>SharedDictionaryError

* **Type**: `string`
* **Allowed values**: `"UseErrorCrossOriginNoCorsRequest"`, `"UseErrorDictionaryLoadFailure"`, `"UseErrorMatchingDictionaryNotUsed"`, `"UseErrorUnexpectedContentDictionaryHeader"`, `"WriteErrorCossOriginNoCorsRequest"`, `"WriteErrorDisallowedBySettings"`, `"WriteErrorExpiredResponse"`, `"WriteErrorFeatureDisabled"`, `"WriteErrorInsufficientResources"`, `"WriteErrorInvalidMatchField"`, `"WriteErrorInvalidStructuredHeader"`, `"WriteErrorInvalidTTLField"`, `"WriteErrorNavigationRequest"`, `"WriteErrorNoMatchField"`, `"WriteErrorNonIntegerTTLField"`, `"WriteErrorNonListMatchDestField"`, `"WriteErrorNonSecureContext"`, `"WriteErrorNonStringIdField"`, `"WriteErrorNonStringInMatchDestList"`, `"WriteErrorInvalidMatchDestList"`, `"WriteErrorNonStringMatchField"`, `"WriteErrorNonTokenTypeField"`, `"WriteErrorRequestAborted"`, `"WriteErrorShuttingDown"`, `"WriteErrorTooLongIdField"`, `"WriteErrorUnsupportedType"`

### <a name="srimessagesignatureerror"></a>SRIMessageSignatureError

* **Type**: `string`
* **Allowed values**: `"MissingSignatureHeader"`, `"MissingSignatureInputHeader"`, `"InvalidSignatureHeader"`, `"InvalidSignatureInputHeader"`, `"SignatureHeaderValueIsNotByteSequence"`, `"SignatureHeaderValueIsParameterized"`, `"SignatureHeaderValueIsIncorrectLength"`, `"SignatureInputHeaderMissingLabel"`, `"SignatureInputHeaderValueNotInnerList"`, `"SignatureInputHeaderValueMissingComponents"`, `"SignatureInputHeaderInvalidComponentType"`, `"SignatureInputHeaderInvalidComponentName"`, `"SignatureInputHeaderInvalidHeaderComponentParameter"`, `"SignatureInputHeaderInvalidDerivedComponentParameter"`, `"SignatureInputHeaderKeyIdLength"`, `"SignatureInputHeaderInvalidParameter"`, `"SignatureInputHeaderMissingRequiredParameters"`, `"ValidationFailedSignatureExpired"`, `"ValidationFailedInvalidLength"`, `"ValidationFailedSignatureMismatch"`, `"ValidationFailedIntegrityMismatch"`, `"SignatureBaseUnknownDerivedComponent"`, `"SignatureBaseMissingHeader"`, `"SignatureBaseInvalidUnencodedDigest"`, `"SignatureBaseUnsupportedComponent"`

### <a name="unencodeddigesterror"></a>UnencodedDigestError

* **Type**: `string`
* **Allowed values**: `"MalformedDictionary"`, `"UnknownAlgorithm"`, `"IncorrectDigestType"`, `"IncorrectDigestLength"`

### <a name="connectionallowlisterror"></a>ConnectionAllowlistError

* **Type**: `string`
* **Allowed values**: `"InvalidHeader"`, `"MoreThanOneList"`, `"ItemNotInnerList"`, `"InvalidAllowlistItemType"`, `"ReportingEndpointNotToken"`, `"InvalidUrlPattern"`

### <a name="attributionreportingissuedetails"></a>AttributionReportingIssueDetails

Details for issues around "Attribution Reporting API" usage.
Explainer: https://github.com/WICG/attribution-reporting-api

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `violationType` | [AttributionReportingIssueType](#attributionreportingissuetype) |  |
| `request`<br/>_optional_ | [AffectedRequest](#affectedrequest) |  |
| `violatingNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) |  |
| `invalidParameter`<br/>_optional_ | `string` |  |


### <a name="quirksmodeissuedetails"></a>QuirksModeIssueDetails

Details for issues about documents in Quirks Mode
or Limited Quirks Mode that affects page layouting.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `isLimitedQuirksMode` | `boolean` | If false, it means the document's mode is "quirks"<br/>instead of "limited-quirks". |
| `documentNodeId` | [DOM.BackendNodeId](DOM.md#backendnodeid) |  |
| `url` | `string` |  |
| `frameId` | [Page.FrameId](Page.md#frameid) |  |
| `loaderId` | [Network.LoaderId](Network.md#loaderid) |  |


### <a name="navigatoruseragentissuedetails"></a>NavigatorUserAgentIssueDetails `⚠️ deprecated`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` |  |
| `location`<br/>_optional_ | [SourceCodeLocation](#sourcecodelocation) |  |


### <a name="shareddictionaryissuedetails"></a>SharedDictionaryIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `sharedDictionaryError` | [SharedDictionaryError](#shareddictionaryerror) |  |
| `request` | [AffectedRequest](#affectedrequest) |  |


### <a name="srimessagesignatureissuedetails"></a>SRIMessageSignatureIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `error` | [SRIMessageSignatureError](#srimessagesignatureerror) |  |
| `signatureBase` | `string` |  |
| `integrityAssertions` | array of `string` |  |
| `request` | [AffectedRequest](#affectedrequest) |  |


### <a name="unencodeddigestissuedetails"></a>UnencodedDigestIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `error` | [UnencodedDigestError](#unencodeddigesterror) |  |
| `request` | [AffectedRequest](#affectedrequest) |  |


### <a name="connectionallowlistissuedetails"></a>ConnectionAllowlistIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `error` | [ConnectionAllowlistError](#connectionallowlisterror) |  |
| `request` | [AffectedRequest](#affectedrequest) |  |


### <a name="genericissueerrortype"></a>GenericIssueErrorType

* **Type**: `string`
* **Allowed values**: `"FormLabelForNameError"`, `"FormDuplicateIdForInputError"`, `"FormInputWithNoLabelError"`, `"FormAutocompleteAttributeEmptyError"`, `"FormEmptyIdAndNameAttributesForInputError"`, `"FormAriaLabelledByToNonExistingIdError"`, `"FormInputAssignedAutocompleteValueToIdOrNameAttributeError"`, `"FormLabelHasNeitherForNorNestedInputError"`, `"FormLabelForMatchesNonExistingIdError"`, `"FormInputHasWrongButWellIntendedAutocompleteValueError"`, `"ResponseWasBlockedByORB"`, `"NavigationEntryMarkedSkippable"`, `"BackUINavigationWouldSkipAd"`, `"AutofillAndManualTextPolicyControlledFeaturesInfo"`, `"AutofillPolicyControlledFeatureInfo"`, `"ManualTextPolicyControlledFeatureInfo"`, `"FormModelContextParameterMissingTitleAndDescription"`, `"FormModelContextMissingToolName"`, `"FormModelContextMissingToolDescription"`, `"FormModelContextRequiredParameterMissingName"`, `"FormModelContextParameterMissingName"`

### <a name="genericissuedetails"></a>GenericIssueDetails

Depending on the concrete errorType, different properties are set.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `errorType` | [GenericIssueErrorType](#genericissueerrortype) | Issues with the same errorType are aggregated in the frontend. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) |  |
| `violatingNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) |  |
| `violatingNodeAttribute`<br/>_optional_ | `string` |  |
| `request`<br/>_optional_ | [AffectedRequest](#affectedrequest) |  |


### <a name="deprecationissuedetails"></a>DeprecationIssueDetails

This issue tracks information needed to print a deprecation message.
https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/frame/third_party/blink/renderer/core/frame/deprecation/README.md

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `affectedFrame`<br/>_optional_ | [AffectedFrame](#affectedframe) |  |
| `sourceCodeLocation` | [SourceCodeLocation](#sourcecodelocation) |  |
| `type` | `string` | One of the deprecation names from third_party/blink/renderer/core/frame/deprecation/deprecation.json5 |


### <a name="bouncetrackingissuedetails"></a>BounceTrackingIssueDetails

This issue warns about sites in the redirect chain of a finished navigation
that may be flagged as trackers and have their state cleared if they don't
receive a user interaction. Note that in this context 'site' means eTLD+1.
For example, if the URL `https://example.test:80/bounce` was in the
redirect chain, the site reported would be `example.test`.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `trackingSites` | array of `string` |  |


### <a name="cookiedeprecationmetadataissuedetails"></a>CookieDeprecationMetadataIssueDetails

This issue warns about third-party sites that are accessing cookies on the
current page, and have been permitted due to having a global metadata grant.
Note that in this context 'site' means eTLD+1. For example, if the URL
`https://example.test:80/web_page` was accessing cookies, the site reported
would be `example.test`.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `allowedSites` | array of `string` |  |
| `optOutPercentage` | `number` |  |
| `isOptOutTopLevel` | `boolean` |  |
| `operation` | [CookieOperation](#cookieoperation) |  |


### <a name="clienthintissuereason"></a>ClientHintIssueReason

* **Type**: `string`
* **Allowed values**: `"MetaTagAllowListInvalidOrigin"`, `"MetaTagModifiedHTML"`

### <a name="federatedauthrequestissuedetails"></a>FederatedAuthRequestIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `federatedAuthRequestIssueReason` | [FederatedAuthRequestIssueReason](#federatedauthrequestissuereason) |  |


### <a name="federatedauthrequestissuereason"></a>FederatedAuthRequestIssueReason

Represents the failure reason when a federated authentication reason fails.
Should be updated alongside RequestIdTokenStatus in
third_party/blink/public/mojom/devtools/inspector_issue.mojom to include
all cases except for success.

* **Type**: `string`
* **Allowed values**: `"ShouldEmbargo"`, `"TooManyRequests"`, `"WellKnownHttpNotFound"`, `"WellKnownNoResponse"`, `"WellKnownInvalidResponse"`, `"WellKnownListEmpty"`, `"WellKnownInvalidContentType"`, `"ConfigNotInWellKnown"`, `"WellKnownTooBig"`, `"ConfigHttpNotFound"`, `"ConfigNoResponse"`, `"ConfigInvalidResponse"`, `"ConfigInvalidContentType"`, `"IdpNotPotentiallyTrustworthy"`, `"DisabledInSettings"`, `"DisabledInFlags"`, `"ErrorFetchingSignin"`, `"InvalidSigninResponse"`, `"AccountsHttpNotFound"`, `"AccountsNoResponse"`, `"AccountsInvalidResponse"`, `"AccountsListEmpty"`, `"AccountsInvalidContentType"`, `"IdTokenHttpNotFound"`, `"IdTokenNoResponse"`, `"IdTokenInvalidResponse"`, `"IdTokenIdpErrorResponse"`, `"IdTokenCrossSiteIdpErrorResponse"`, `"IdTokenInvalidRequest"`, `"IdTokenInvalidContentType"`, `"ErrorIdToken"`, `"Canceled"`, `"RpPageNotVisible"`, `"SilentMediationFailure"`, `"NotSignedInWithIdp"`, `"MissingTransientUserActivation"`, `"ReplacedByActiveMode"`, `"RelyingPartyOriginIsOpaque"`, `"TypeNotMatching"`, `"UiDismissedNoEmbargo"`, `"CorsError"`, `"SuppressedBySegmentationPlatform"`

### <a name="federatedauthuserinforequestissuedetails"></a>FederatedAuthUserInfoRequestIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `federatedAuthUserInfoRequestIssueReason` | [FederatedAuthUserInfoRequestIssueReason](#federatedauthuserinforequestissuereason) |  |


### <a name="federatedauthuserinforequestissuereason"></a>FederatedAuthUserInfoRequestIssueReason

Represents the failure reason when a getUserInfo() call fails.
Should be updated alongside FederatedAuthUserInfoRequestResult in
third_party/blink/public/mojom/devtools/inspector_issue.mojom.

* **Type**: `string`
* **Allowed values**: `"NotSameOrigin"`, `"NotIframe"`, `"NotPotentiallyTrustworthy"`, `"NoApiPermission"`, `"NotSignedInWithIdp"`, `"NoAccountSharingPermission"`, `"InvalidConfigOrWellKnown"`, `"InvalidAccountsResponse"`, `"NoReturningUserFromFetchedAccounts"`

### <a name="emailverificationrequestissuedetails"></a>EmailVerificationRequestIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `emailVerificationRequestIssueReason` | [EmailVerificationRequestIssueReason](#emailverificationrequestissuereason) |  |


### <a name="emailverificationrequestissuereason"></a>EmailVerificationRequestIssueReason

Represents the failure reason when an email verification request fails.
Should be updated alongside EmailVerificationRequestResult in
third_party/blink/public/mojom/devtools/inspector_issue.mojom.

* **Type**: `string`
* **Allowed values**: `"InvalidEmail"`, `"DnsFetchFailed"`, `"DnsInvalidRecord"`, `"WellKnownHttpNotFound"`, `"WellKnownNoResponse"`, `"WellKnownInvalidResponse"`, `"WellKnownListEmpty"`, `"WellKnownInvalidContentType"`, `"WellKnownMissingIssuanceEndpoint"`, `"WellKnownIssuanceEndpointCrossOrigin"`, `"WellKnownUnsupportedSigningAlgorithm"`, `"TokenHttpNotFound"`, `"TokenNoResponse"`, `"TokenInvalidResponse"`, `"TokenInvalidContentType"`, `"TokenMalformedSdJwt"`, `"TokenInvalidSdJwt"`, `"KeyBindingSigningFailed"`, `"RpOriginIsOpaque"`, `"WellKnownMissingAccountsEndpoint"`, `"UserLoggedOut"`, `"WellKnownAccountsEndpointCrossOrigin"`, `"AccountsHttpNotFound"`, `"AccountsNoResponse"`, `"AccountsInvalidResponse"`, `"AccountsInvalidContentType"`, `"AccountsEmptyList"`, `"EmailVerificationWellKnownHttpNotFound"`, `"EmailVerificationWellKnownNoResponse"`, `"EmailVerificationWellKnownInvalidResponse"`, `"EmailVerificationWellKnownInvalidContentType"`, `"JwksHttpNotFound"`, `"JwksInvalidResponse"`, `"TokenVerificationSdJwtUnsupportedHeaderAlg"`, `"TokenVerificationSdJwtInvalidTyp"`, `"TokenVerificationSdJwtMissingIss"`, `"TokenVerificationSdJwtMissingIat"`, `"TokenVerificationSdJwtMissingCnf"`, `"TokenVerificationSdJwtMissingEmail"`, `"TokenVerificationSdJwtInvalidIssuedAt"`, `"TokenVerificationSdJwtInvalidIssuer"`, `"TokenVerificationSdJwtJwksMissingKeys"`, `"TokenVerificationSdJwtSignatureFailed"`, `"TokenVerificationSdJwtInvalidEmailVerified"`, `"TokenVerificationSdJwtInvalidEmail"`, `"TokenVerificationSdJwtInvalidHolderKey"`, `"TokenVerificationKbInvalidTyp"`, `"TokenVerificationKbMissingAud"`, `"TokenVerificationKbMissingNonce"`, `"TokenVerificationKbMissingIat"`, `"TokenVerificationKbMissingSdHash"`, `"TokenVerificationKbInvalidIssuedAt"`, `"TokenVerificationKbInvalidAudience"`, `"TokenVerificationKbInvalidNonce"`, `"TokenVerificationKbInvalidSdHash"`, `"TokenVerificationKbMissingCnf"`, `"TokenVerificationKbSignatureFailed"`

### <a name="clienthintissuedetails"></a>ClientHintIssueDetails

This issue tracks client hints related issues. It's used to deprecate old
features, encourage the use of new ones, and provide general guidance.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `sourceCodeLocation` | [SourceCodeLocation](#sourcecodelocation) |  |
| `clientHintIssueReason` | [ClientHintIssueReason](#clienthintissuereason) |  |


### <a name="failedrequestinfo"></a>FailedRequestInfo

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | The URL that failed to load. |
| `failureMessage` | `string` | The failure message for the failed request. |
| `requestId`<br/>_optional_ | [Network.RequestId](Network.md#requestid) |  |


### <a name="partitioningbloburlinfo"></a>PartitioningBlobURLInfo

* **Type**: `string`
* **Allowed values**: `"BlockedCrossPartitionFetching"`, `"EnforceNoopenerForNavigation"`

### <a name="partitioningbloburlissuedetails"></a>PartitioningBlobURLIssueDetails

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | The BlobURL that failed to load. |
| `partitioningBlobURLInfo` | [PartitioningBlobURLInfo](#partitioningbloburlinfo) | Additional information about the Partitioning Blob URL issue. |


### <a name="elementaccessibilityissuereason"></a>ElementAccessibilityIssueReason

* **Type**: `string`
* **Allowed values**: `"DisallowedSelectChild"`, `"DisallowedOptGroupChild"`, `"NonPhrasingContentOptionChild"`, `"InteractiveContentOptionChild"`, `"InteractiveContentLegendChild"`, `"InteractiveContentSummaryDescendant"`

### <a name="elementaccessibilityissuedetails"></a>ElementAccessibilityIssueDetails

This issue warns about errors in the select or summary element content model.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.BackendNodeId](DOM.md#backendnodeid) |  |
| `elementAccessibilityIssueReason` | [ElementAccessibilityIssueReason](#elementaccessibilityissuereason) |  |
| `hasDisallowedAttributes` | `boolean` |  |


### <a name="stylesheetloadingissuereason"></a>StyleSheetLoadingIssueReason

* **Type**: `string`
* **Allowed values**: `"LateImportRule"`, `"RequestFailed"`

### <a name="stylesheetloadingissuedetails"></a>StylesheetLoadingIssueDetails

This issue warns when a referenced stylesheet couldn't be loaded.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `sourceCodeLocation` | [SourceCodeLocation](#sourcecodelocation) | Source code position that referenced the failing stylesheet. |
| `styleSheetLoadingIssueReason` | [StyleSheetLoadingIssueReason](#stylesheetloadingissuereason) | Reason why the stylesheet couldn't be loaded. |
| `failedRequestInfo`<br/>_optional_ | [FailedRequestInfo](#failedrequestinfo) | Contains additional info when the failure was due to a request. |


### <a name="propertyruleissuereason"></a>PropertyRuleIssueReason

* **Type**: `string`
* **Allowed values**: `"InvalidSyntax"`, `"InvalidInitialValue"`, `"InvalidInherits"`, `"InvalidName"`

### <a name="propertyruleissuedetails"></a>PropertyRuleIssueDetails

This issue warns about errors in property rules that lead to property
registrations being ignored.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `sourceCodeLocation` | [SourceCodeLocation](#sourcecodelocation) | Source code position of the property rule. |
| `propertyRuleIssueReason` | [PropertyRuleIssueReason](#propertyruleissuereason) | Reason why the property rule was discarded. |
| `propertyValue`<br/>_optional_ | `string` | The value of the property rule property that failed to parse |


### <a name="userreidentificationissuetype"></a>UserReidentificationIssueType

* **Type**: `string`
* **Allowed values**: `"BlockedFrameNavigation"`, `"BlockedSubresource"`, `"NoisedCanvasReadback"`

### <a name="userreidentificationissuedetails"></a>UserReidentificationIssueDetails

This issue warns about uses of APIs that may be considered misuse to
re-identify users.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | [UserReidentificationIssueType](#userreidentificationissuetype) |  |
| `request`<br/>_optional_ | [AffectedRequest](#affectedrequest) | Applies to BlockedFrameNavigation and BlockedSubresource issue types. |
| `sourceCodeLocation`<br/>_optional_ | [SourceCodeLocation](#sourcecodelocation) | Applies to NoisedCanvasReadback issue type. |


### <a name="permissionelementissuetype"></a>PermissionElementIssueType

* **Type**: `string`
* **Allowed values**: `"InvalidType"`, `"FencedFrameDisallowed"`, `"CspFrameAncestorsMissing"`, `"PermissionsPolicyBlocked"`, `"PaddingRightUnsupported"`, `"PaddingBottomUnsupported"`, `"InsetBoxShadowUnsupported"`, `"RequestInProgress"`, `"UntrustedEvent"`, `"RegistrationFailed"`, `"TypeNotSupported"`, `"InvalidTypeActivation"`, `"SecurityChecksFailed"`, `"ActivationDisabled"`, `"GeolocationDeprecated"`, `"InvalidDisplayStyle"`, `"NonOpaqueColor"`, `"LowContrast"`, `"FontSizeTooSmall"`, `"FontSizeTooLarge"`, `"InvalidSizeValue"`, `"NonSecureContext"`, `"MissingTransientUserActivation"`

### <a name="permissionelementissuedetails"></a>PermissionElementIssueDetails

This issue warns about improper usage of the <permission> element.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `issueType` | [PermissionElementIssueType](#permissionelementissuetype) |  |
| `type`<br/>_optional_ | `string` | The value of the type attribute. |
| `nodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | The node ID of the <permission> element. |
| `isWarning`<br/>_optional_ | `boolean` | True if the issue is a warning, false if it is an error. |
| `permissionName`<br/>_optional_ | `string` | Fields for message construction:<br/>Used for messages that reference a specific permission name |
| `occluderNodeInfo`<br/>_optional_ | `string` | Used for messages about occlusion |
| `occluderParentNodeInfo`<br/>_optional_ | `string` | Used for messages about occluder's parent |
| `disableReason`<br/>_optional_ | `string` | Used for messages about activation disabled reason |


### <a name="selectivepermissionsinterventionissuedetails"></a>SelectivePermissionsInterventionIssueDetails

The issue warns about blocked calls to privacy sensitive APIs via the
Selective Permissions Intervention.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `apiName` | `string` | Which API was intervened on. |
| `adAncestry` | [Network.AdAncestry](Network.md#adancestry) | Why the ad script using the API is considered an ad. |
| `stackTrace`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | The stack trace at the time of the intervention. |


### <a name="inspectorissuecode"></a>InspectorIssueCode

A unique identifier for the type of issue. Each type may use one of the
optional fields in InspectorIssueDetails to convey more specific
information about the kind of issue.

* **Type**: `string`
* **Allowed values**: `"CookieIssue"`, `"MixedContentIssue"`, `"BlockedByResponseIssue"`, `"HeavyAdIssue"`, `"ContentSecurityPolicyIssue"`, `"SharedArrayBufferIssue"`, `"CorsIssue"`, `"AttributionReportingIssue"`, `"QuirksModeIssue"`, `"PartitioningBlobURLIssue"`, `"NavigatorUserAgentIssue"`, `"GenericIssue"`, `"DeprecationIssue"`, `"ClientHintIssue"`, `"FederatedAuthRequestIssue"`, `"BounceTrackingIssue"`, `"CookieDeprecationMetadataIssue"`, `"StylesheetLoadingIssue"`, `"FederatedAuthUserInfoRequestIssue"`, `"PropertyRuleIssue"`, `"SharedDictionaryIssue"`, `"ElementAccessibilityIssue"`, `"SRIMessageSignatureIssue"`, `"UnencodedDigestIssue"`, `"ConnectionAllowlistIssue"`, `"UserReidentificationIssue"`, `"PermissionElementIssue"`, `"PerformanceIssue"`, `"SelectivePermissionsInterventionIssue"`, `"EmailVerificationRequestIssue"`

### <a name="inspectorissuedetails"></a>InspectorIssueDetails

This struct holds a list of optional fields with additional information
specific to the kind of issue. When adding a new issue code, please also
add a new optional field to this type.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `cookieIssueDetails`<br/>_optional_ | [CookieIssueDetails](#cookieissuedetails) |  |
| `mixedContentIssueDetails`<br/>_optional_ | [MixedContentIssueDetails](#mixedcontentissuedetails) |  |
| `blockedByResponseIssueDetails`<br/>_optional_ | [BlockedByResponseIssueDetails](#blockedbyresponseissuedetails) |  |
| `heavyAdIssueDetails`<br/>_optional_ | [HeavyAdIssueDetails](#heavyadissuedetails) |  |
| `contentSecurityPolicyIssueDetails`<br/>_optional_ | [ContentSecurityPolicyIssueDetails](#contentsecuritypolicyissuedetails) |  |
| `sharedArrayBufferIssueDetails`<br/>_optional_ | [SharedArrayBufferIssueDetails](#sharedarraybufferissuedetails) |  |
| `corsIssueDetails`<br/>_optional_ | [CorsIssueDetails](#corsissuedetails) |  |
| `attributionReportingIssueDetails`<br/>_optional_ | [AttributionReportingIssueDetails](#attributionreportingissuedetails) |  |
| `quirksModeIssueDetails`<br/>_optional_ | [QuirksModeIssueDetails](#quirksmodeissuedetails) |  |
| `partitioningBlobURLIssueDetails`<br/>_optional_ | [PartitioningBlobURLIssueDetails](#partitioningbloburlissuedetails) |  |
| `navigatorUserAgentIssueDetails`<br/>_optional_ | [NavigatorUserAgentIssueDetails](#navigatoruseragentissuedetails) | `⚠️ deprecated` |
| `genericIssueDetails`<br/>_optional_ | [GenericIssueDetails](#genericissuedetails) |  |
| `deprecationIssueDetails`<br/>_optional_ | [DeprecationIssueDetails](#deprecationissuedetails) |  |
| `clientHintIssueDetails`<br/>_optional_ | [ClientHintIssueDetails](#clienthintissuedetails) |  |
| `federatedAuthRequestIssueDetails`<br/>_optional_ | [FederatedAuthRequestIssueDetails](#federatedauthrequestissuedetails) |  |
| `bounceTrackingIssueDetails`<br/>_optional_ | [BounceTrackingIssueDetails](#bouncetrackingissuedetails) |  |
| `cookieDeprecationMetadataIssueDetails`<br/>_optional_ | [CookieDeprecationMetadataIssueDetails](#cookiedeprecationmetadataissuedetails) |  |
| `stylesheetLoadingIssueDetails`<br/>_optional_ | [StylesheetLoadingIssueDetails](#stylesheetloadingissuedetails) |  |
| `propertyRuleIssueDetails`<br/>_optional_ | [PropertyRuleIssueDetails](#propertyruleissuedetails) |  |
| `federatedAuthUserInfoRequestIssueDetails`<br/>_optional_ | [FederatedAuthUserInfoRequestIssueDetails](#federatedauthuserinforequestissuedetails) |  |
| `sharedDictionaryIssueDetails`<br/>_optional_ | [SharedDictionaryIssueDetails](#shareddictionaryissuedetails) |  |
| `elementAccessibilityIssueDetails`<br/>_optional_ | [ElementAccessibilityIssueDetails](#elementaccessibilityissuedetails) |  |
| `sriMessageSignatureIssueDetails`<br/>_optional_ | [SRIMessageSignatureIssueDetails](#srimessagesignatureissuedetails) |  |
| `unencodedDigestIssueDetails`<br/>_optional_ | [UnencodedDigestIssueDetails](#unencodeddigestissuedetails) |  |
| `connectionAllowlistIssueDetails`<br/>_optional_ | [ConnectionAllowlistIssueDetails](#connectionallowlistissuedetails) |  |
| `userReidentificationIssueDetails`<br/>_optional_ | [UserReidentificationIssueDetails](#userreidentificationissuedetails) |  |
| `permissionElementIssueDetails`<br/>_optional_ | [PermissionElementIssueDetails](#permissionelementissuedetails) |  |
| `performanceIssueDetails`<br/>_optional_ | [PerformanceIssueDetails](#performanceissuedetails) |  |
| `selectivePermissionsInterventionIssueDetails`<br/>_optional_ | [SelectivePermissionsInterventionIssueDetails](#selectivepermissionsinterventionissuedetails) |  |
| `emailVerificationRequestIssueDetails`<br/>_optional_ | [EmailVerificationRequestIssueDetails](#emailverificationrequestissuedetails) |  |


### <a name="issueid"></a>IssueId

A unique id for a DevTools inspector issue. Allows other entities (e.g.
exceptions, CDP message, console messages, etc.) to reference an issue.

* **Type**: `string`

### <a name="inspectorissue"></a>InspectorIssue

An inspector issue reported from the back-end.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `code` | [InspectorIssueCode](#inspectorissuecode) |  |
| `details` | [InspectorIssueDetails](#inspectorissuedetails) |  |
| `issueId`<br/>_optional_ | [IssueId](#issueid) | A unique id for this issue. May be omitted if no other entity (e.g.<br/>exception, CDP message, etc.) is referencing this issue. |


---

<a name="commands"></a>
## Commands

### <a name="getencodedresponse"></a>getEncodedResponse

Returns the response body and size if it were re-encoded with the specified settings. Only
applies to images.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [Network.RequestId](Network.md#requestid) | Identifier of the network request to get content for. |
| `encoding` | `string` | The encoding to use.<br/>Allowed values: `"webp"`, `"jpeg"`, `"png"` |
| `quality`<br/>_optional_ | `number` | The quality of the encoding (0-1). (defaults to 1) |
| `sizeOnly`<br/>_optional_ | `boolean` | Whether to only return the size information (defaults to false). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `body`<br/>_optional_ | `string` | The encoded body as a base64 string. Omitted if sizeOnly is true. (Encoded as a base64 string when passed over JSON) |
| `originalSize` | `integer` | Size before re-encoding. |
| `encodedSize` | `integer` | Size after re-encoding. |


### <a name="disable"></a>disable

Disables issues domain, prevents further issues from being reported to the client.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables issues domain, sends the issues collected so far to the client by means of the
`issueAdded` event.

* **Parameters**: None

* **Returns**: None


### <a name="checkformsissues"></a>checkFormsIssues

Runs the form issues check for the target page. Found issues are reported
using Audits.issueAdded event.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `formIssues` | array of [GenericIssueDetails](#genericissuedetails) |  |


---

<a name="events"></a>
## Events

### <a name="issueadded"></a>issueAdded

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `issue` | [InspectorIssue](#inspectorissue) |  |


