# Preload

`🧪 Experimental`

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

### <a name="rulesetid"></a>RuleSetId

Unique id

* **Type**: `string`

### <a name="ruleset"></a>RuleSet

Corresponds to SpeculationRuleSet

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [RuleSetId](#rulesetid) |  |
| `loaderId` | [Network.LoaderId](Network.md#loaderid) | Identifies a document which the rule set is associated with. |
| `sourceText` | `string` | Source text of JSON representing the rule set. If it comes from<br/>`<script>` tag, it is the textContent of the node. Note that it is<br/>a JSON for valid case.<br/><br/>See also:<br/>- https://wicg.github.io/nav-speculation/speculation-rules.html<br/>- https://github.com/WICG/nav-speculation/blob/main/triggers.md |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | A speculation rule set is either added through an inline<br/>`<script>` tag or through an external resource via the<br/>'Speculation-Rules' HTTP header. For the first case, we include<br/>the BackendNodeId of the relevant `<script>` tag. For the second<br/>case, we include the external URL where the rule set was loaded<br/>from, and also RequestId if Network domain is enabled.<br/><br/>See also:<br/>- https://wicg.github.io/nav-speculation/speculation-rules.html#speculation-rules-script<br/>- https://wicg.github.io/nav-speculation/speculation-rules.html#speculation-rules-header |
| `url`<br/>_optional_ | `string` |  |
| `requestId`<br/>_optional_ | [Network.RequestId](Network.md#requestid) |  |
| `errorType`<br/>_optional_ | [RuleSetErrorType](#ruleseterrortype) | Error information<br/>`errorMessage` is null iff `errorType` is null. |
| `errorMessage`<br/>_optional_ | `string` | `⚠️ deprecated` TODO(https://crbug.com/1425354): Replace this property with structured error. |
| `tag`<br/>_optional_ | `string` | For more details, see:<br/>https://github.com/WICG/nav-speculation/blob/main/speculation-rules-tags.md |


### <a name="ruleseterrortype"></a>RuleSetErrorType

* **Type**: `string`
* **Allowed values**: `"SourceIsNotJsonObject"`, `"InvalidRulesSkipped"`, `"InvalidRulesetLevelTag"`

### <a name="speculationaction"></a>SpeculationAction

The type of preloading attempted. It corresponds to
mojom::SpeculationAction (although PrefetchWithSubresources is omitted as it
isn't being used by clients).

* **Type**: `string`
* **Allowed values**: `"Prefetch"`, `"Prerender"`, `"PrerenderUntilScript"`

### <a name="speculationtargethint"></a>SpeculationTargetHint

Corresponds to mojom::SpeculationTargetHint.
See https://github.com/WICG/nav-speculation/blob/main/triggers.md#window-name-targeting-hints

* **Type**: `string`
* **Allowed values**: `"Blank"`, `"Self"`

### <a name="preloadingattemptkey"></a>PreloadingAttemptKey

A key that identifies a preloading attempt.

The url used is the url specified by the trigger (i.e. the initial URL), and
not the final url that is navigated to. For example, prerendering allows
same-origin main frame navigations during the attempt, but the attempt is
still keyed with the initial URL.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `loaderId` | [Network.LoaderId](Network.md#loaderid) |  |
| `action` | [SpeculationAction](#speculationaction) |  |
| `url` | `string` |  |
| `formSubmission`<br/>_optional_ | `boolean` |  |
| `targetHint`<br/>_optional_ | [SpeculationTargetHint](#speculationtargethint) |  |


### <a name="preloadingattemptsource"></a>PreloadingAttemptSource

Lists sources for a preloading attempt, specifically the ids of rule sets
that had a speculation rule that triggered the attempt, and the
BackendNodeIds of <a href> or <area href> elements that triggered the
attempt (in the case of attempts triggered by a document rule). It is
possible for multiple rule sets and links to trigger a single attempt.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | [PreloadingAttemptKey](#preloadingattemptkey) |  |
| `ruleSetIds` | array of [RuleSetId](#rulesetid) |  |
| `nodeIds` | array of [DOM.BackendNodeId](DOM.md#backendnodeid) |  |


### <a name="preloadpipelineid"></a>PreloadPipelineId

Chrome manages different types of preloads together using a
concept of preloading pipeline. For example, if a site uses a
SpeculationRules for prerender, Chrome first starts a prefetch and
then upgrades it to prerender.

CDP events for them are emitted separately but they share
`PreloadPipelineId`.

* **Type**: `string`

### <a name="prerenderfinalstatus"></a>PrerenderFinalStatus

List of FinalStatus reasons for Prerender2.

* **Type**: `string`
* **Allowed values**: `"Activated"`, `"Destroyed"`, `"LowEndDevice"`, `"InvalidSchemeRedirect"`, `"InvalidSchemeNavigation"`, `"NavigationRequestBlockedByCsp"`, `"MojoBinderPolicy"`, `"RendererProcessCrashed"`, `"RendererProcessKilled"`, `"Download"`, `"TriggerDestroyed"`, `"NavigationNotCommitted"`, `"NavigationBadHttpStatus"`, `"ClientCertRequested"`, `"NavigationRequestNetworkError"`, `"CancelAllHostsForTesting"`, `"DidFailLoad"`, `"Stop"`, `"SslCertificateError"`, `"LoginAuthRequested"`, `"UaChangeRequiresReload"`, `"BlockedByClient"`, `"AudioOutputDeviceRequested"`, `"MixedContent"`, `"TriggerBackgrounded"`, `"MemoryLimitExceeded"`, `"DataSaverEnabled"`, `"TriggerUrlHasEffectiveUrl"`, `"ActivatedBeforeStarted"`, `"InactivePageRestriction"`, `"StartFailed"`, `"TimeoutBackgrounded"`, `"CrossSiteRedirectInInitialNavigation"`, `"CrossSiteNavigationInInitialNavigation"`, `"SameSiteCrossOriginRedirectNotOptInInInitialNavigation"`, `"SameSiteCrossOriginNavigationNotOptInInInitialNavigation"`, `"ActivationNavigationParameterMismatch"`, `"ActivatedInBackground"`, `"EmbedderHostDisallowed"`, `"ActivationNavigationDestroyedBeforeSuccess"`, `"TabClosedByUserGesture"`, `"TabClosedWithoutUserGesture"`, `"PrimaryMainFrameRendererProcessCrashed"`, `"PrimaryMainFrameRendererProcessKilled"`, `"ActivationFramePolicyNotCompatible"`, `"PreloadingDisabled"`, `"BatterySaverEnabled"`, `"ActivatedDuringMainFrameNavigation"`, `"PreloadingUnsupportedByWebContents"`, `"CrossSiteRedirectInMainFrameNavigation"`, `"CrossSiteNavigationInMainFrameNavigation"`, `"SameSiteCrossOriginRedirectNotOptInInMainFrameNavigation"`, `"SameSiteCrossOriginNavigationNotOptInInMainFrameNavigation"`, `"MemoryPressureOnTrigger"`, `"MemoryPressureAfterTriggered"`, `"PrerenderingDisabledByDevTools"`, `"SpeculationRuleRemoved"`, `"ActivatedWithAuxiliaryBrowsingContexts"`, `"MaxNumOfRunningEagerPrerendersExceeded"`, `"MaxNumOfRunningNonEagerPrerendersExceeded"`, `"MaxNumOfRunningEmbedderPrerendersExceeded"`, `"PrerenderingUrlHasEffectiveUrl"`, `"RedirectedPrerenderingUrlHasEffectiveUrl"`, `"ActivationUrlHasEffectiveUrl"`, `"JavaScriptInterfaceAdded"`, `"JavaScriptInterfaceRemoved"`, `"AllPrerenderingCanceled"`, `"WindowClosed"`, `"SlowNetwork"`, `"OtherPrerenderedPageActivated"`, `"V8OptimizerDisabled"`, `"PrerenderFailedDuringPrefetch"`, `"BrowsingDataRemoved"`, `"PrerenderHostReused"`, `"FormSubmitWhenPrerendering"`, `"CrossDocumentRestart"`

### <a name="preloadingstatus"></a>PreloadingStatus

Preloading status values, see also PreloadingTriggeringOutcome. This
status is shared by prefetchStatusUpdated and prerenderStatusUpdated.

* **Type**: `string`
* **Allowed values**: `"Pending"`, `"Running"`, `"Ready"`, `"Success"`, `"Failure"`, `"NotSupported"`

### <a name="prefetchstatus"></a>PrefetchStatus

TODO(https://crbug.com/1384419): revisit the list of PrefetchStatus and
filter out the ones that aren't necessary to the developers.

* **Type**: `string`
* **Allowed values**: `"PrefetchAllowed"`, `"PrefetchFailedIneligibleRedirect"`, `"PrefetchFailedInvalidRedirect"`, `"PrefetchFailedMIMENotSupported"`, `"PrefetchFailedNetError"`, `"PrefetchFailedNon2XX"`, `"PrefetchEvictedAfterBrowsingDataRemoved"`, `"PrefetchEvictedAfterCandidateRemoved"`, `"PrefetchEvictedForNewerPrefetch"`, `"PrefetchHeldback"`, `"PrefetchIneligibleRetryAfter"`, `"PrefetchIsPrivacyDecoy"`, `"PrefetchIsStale"`, `"PrefetchNotEligibleBlockedByConnectionAllowlist"`, `"PrefetchNotEligibleBrowserContextOffTheRecord"`, `"PrefetchNotEligibleDataSaverEnabled"`, `"PrefetchNotEligibleExistingProxy"`, `"PrefetchNotEligibleHostIsNonUnique"`, `"PrefetchNotEligibleNonDefaultStoragePartition"`, `"PrefetchNotEligibleSameSiteCrossOriginPrefetchRequiredProxy"`, `"PrefetchNotEligibleSchemeIsNotHttps"`, `"PrefetchNotEligibleUserHasCookies"`, `"PrefetchNotEligibleUserHasServiceWorker"`, `"PrefetchNotEligibleUserHasServiceWorkerNoFetchHandler"`, `"PrefetchNotEligibleRedirectFromServiceWorker"`, `"PrefetchNotEligibleRedirectToServiceWorker"`, `"PrefetchNotEligibleBatterySaverEnabled"`, `"PrefetchNotEligiblePreloadingDisabled"`, `"PrefetchNotFinishedInTime"`, `"PrefetchNotStarted"`, `"PrefetchNotUsedCookiesChanged"`, `"PrefetchProxyNotAvailable"`, `"PrefetchResponseUsed"`, `"PrefetchSuccessfulButNotUsed"`, `"PrefetchNotUsedProbeFailed"`, `"PrefetchCancelledOnUserNavigation"`

### <a name="prerendermismatchedheaders"></a>PrerenderMismatchedHeaders

Information of headers to be displayed when the header mismatch occurred.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `headerName` | `string` |  |
| `initialValue`<br/>_optional_ | `string` |  |
| `activationValue`<br/>_optional_ | `string` |  |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="rulesetupdated"></a>ruleSetUpdated

Upsert. Currently, it is only emitted when a rule set added.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ruleSet` | [RuleSet](#ruleset) |  |


### <a name="rulesetremoved"></a>ruleSetRemoved

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [RuleSetId](#rulesetid) |  |


### <a name="preloadenabledstateupdated"></a>preloadEnabledStateUpdated

Fired when a preload enabled state is updated.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `disabledByPreference` | `boolean` |  |
| `disabledByDataSaver` | `boolean` |  |
| `disabledByBatterySaver` | `boolean` |  |
| `disabledByHoldbackPrefetchSpeculationRules` | `boolean` |  |
| `disabledByHoldbackPrerenderSpeculationRules` | `boolean` |  |


### <a name="prefetchstatusupdated"></a>prefetchStatusUpdated

Fired when a prefetch attempt is updated.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | [PreloadingAttemptKey](#preloadingattemptkey) |  |
| `pipelineId` | [PreloadPipelineId](#preloadpipelineid) |  |
| `initiatingFrameId` | [Page.FrameId](Page.md#frameid) | The frame id of the frame initiating prefetch. |
| `prefetchUrl` | `string` |  |
| `status` | [PreloadingStatus](#preloadingstatus) |  |
| `prefetchStatus` | [PrefetchStatus](#prefetchstatus) |  |
| `requestId` | [Network.RequestId](Network.md#requestid) |  |


### <a name="prerenderstatusupdated"></a>prerenderStatusUpdated

Fired when a prerender attempt is updated.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | [PreloadingAttemptKey](#preloadingattemptkey) |  |
| `pipelineId` | [PreloadPipelineId](#preloadpipelineid) |  |
| `status` | [PreloadingStatus](#preloadingstatus) |  |
| `prerenderStatus`<br/>_optional_ | [PrerenderFinalStatus](#prerenderfinalstatus) |  |
| `disallowedMojoInterface`<br/>_optional_ | `string` | This is used to give users more information about the name of Mojo interface<br/>that is incompatible with prerender and has caused the cancellation of the attempt. |
| `mismatchedHeaders`<br/>_optional_ | array of [PrerenderMismatchedHeaders](#prerendermismatchedheaders) |  |


### <a name="preloadingattemptsourcesupdated"></a>preloadingAttemptSourcesUpdated

Send a list of sources for all preloading attempts in a document.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `loaderId` | [Network.LoaderId](Network.md#loaderid) |  |
| `preloadingAttemptSources` | array of [PreloadingAttemptSource](#preloadingattemptsource) |  |


