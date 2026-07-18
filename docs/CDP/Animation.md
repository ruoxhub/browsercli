# Animation

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Runtime](Runtime.md), [DOM](DOM.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="animation"></a>Animation

Animation instance.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | `Animation`'s id. |
| `name` | `string` | `Animation`'s name. |
| `pausedState` | `boolean` | `Animation`'s internal paused state. |
| `playState` | `string` | `Animation`'s play state. |
| `playbackRate` | `number` | `Animation`'s playback rate. |
| `startTime` | `number` | `Animation`'s start time.<br/>Milliseconds for time based animations and<br/>percentage [0 - 100] for scroll driven animations<br/>(i.e. when viewOrScrollTimeline exists). |
| `currentTime` | `number` | `Animation`'s current time. |
| `type` | `string` | Animation type of `Animation`.<br/>Allowed values: `"CSSTransition"`, `"CSSAnimation"`, `"WebAnimation"` |
| `source`<br/>_optional_ | [AnimationEffect](#animationeffect) | `Animation`'s source animation node. |
| `cssId`<br/>_optional_ | `string` | A unique ID for `Animation` representing the sources that triggered this CSS<br/>animation/transition. |
| `viewOrScrollTimeline`<br/>_optional_ | [ViewOrScrollTimeline](#vieworscrolltimeline) | View or scroll timeline |


### <a name="vieworscrolltimeline"></a>ViewOrScrollTimeline

Timeline instance

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `sourceNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Scroll container node |
| `startOffset`<br/>_optional_ | `number` | Represents the starting scroll position of the timeline<br/>as a length offset in pixels from scroll origin. |
| `endOffset`<br/>_optional_ | `number` | Represents the ending scroll position of the timeline<br/>as a length offset in pixels from scroll origin. |
| `subjectNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | The element whose principal box's visibility in the<br/>scrollport defined the progress of the timeline.<br/>Does not exist for animations with ScrollTimeline |
| `axis` | [DOM.ScrollOrientation](DOM.md#scrollorientation) | Orientation of the scroll |


### <a name="animationeffect"></a>AnimationEffect

AnimationEffect instance

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `delay` | `number` | `AnimationEffect`'s delay. |
| `endDelay` | `number` | `AnimationEffect`'s end delay. |
| `iterationStart` | `number` | `AnimationEffect`'s iteration start. |
| `iterations`<br/>_optional_ | `number` | `AnimationEffect`'s iterations. Omitted if the value is infinite. |
| `duration` | `number` | `AnimationEffect`'s iteration duration.<br/>Milliseconds for time based animations and<br/>percentage [0 - 100] for scroll driven animations<br/>(i.e. when viewOrScrollTimeline exists). |
| `direction` | `string` | `AnimationEffect`'s playback direction. |
| `fill` | `string` | `AnimationEffect`'s fill mode. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | `AnimationEffect`'s target node. |
| `keyframesRule`<br/>_optional_ | [KeyframesRule](#keyframesrule) | `AnimationEffect`'s keyframes. |
| `easing` | `string` | `AnimationEffect`'s timing function. |


### <a name="keyframesrule"></a>KeyframesRule

Keyframes Rule

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name`<br/>_optional_ | `string` | CSS keyframed animation's name. |
| `keyframes` | array of [KeyframeStyle](#keyframestyle) | List of animation keyframes. |


### <a name="keyframestyle"></a>KeyframeStyle

Keyframe Style

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `offset` | `string` | Keyframe's time offset. |
| `easing` | `string` | `AnimationEffect`'s timing function. |


---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

Disables animation domain notifications.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables animation domain notifications.

* **Parameters**: None

* **Returns**: None


### <a name="getcurrenttime"></a>getCurrentTime

Returns the current time of the an animation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | Id of animation. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `currentTime` | `number` | Current time of the page. |


### <a name="getplaybackrate"></a>getPlaybackRate

Gets the playback rate of the document timeline.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `playbackRate` | `number` | Playback rate for animations on page. |


### <a name="releaseanimations"></a>releaseAnimations

Releases a set of animations to no longer be manipulated.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `animations` | array of `string` | List of animation ids to seek. |

* **Returns**: None


### <a name="resolveanimation"></a>resolveAnimation

Gets the remote object of the Animation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `animationId` | `string` | Animation id. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `remoteObject` | [Runtime.RemoteObject](Runtime.md#remoteobject) | Corresponding remote object. |


### <a name="seekanimations"></a>seekAnimations

Seek a set of animations to a particular time within each animation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `animations` | array of `string` | List of animation ids to seek. |
| `currentTime` | `number` | Set the current time of each animation. |

* **Returns**: None


### <a name="setpaused"></a>setPaused

Sets the paused state of a set of animations.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `animations` | array of `string` | Animations to set the pause state of. |
| `paused` | `boolean` | Paused state to set to. |

* **Returns**: None


### <a name="setplaybackrate"></a>setPlaybackRate

Sets the playback rate of the document timeline.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `playbackRate` | `number` | Playback rate for animations on page |

* **Returns**: None


### <a name="settiming"></a>setTiming

Sets the timing of an animation node.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `animationId` | `string` | Animation id. |
| `duration` | `number` | Duration of the animation. |
| `delay` | `number` | Delay of the animation. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="animationcanceled"></a>animationCanceled

Event for when an animation has been cancelled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | Id of the animation that was cancelled. |


### <a name="animationcreated"></a>animationCreated

Event for each animation that has been created.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | Id of the animation that was created. |


### <a name="animationstarted"></a>animationStarted

Event for animation that has been started.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `animation` | [Animation](#animation) | Animation that was started. |


### <a name="animationupdated"></a>animationUpdated

Event for animation that has been updated.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `animation` | [Animation](#animation) | Animation that was updated. |


