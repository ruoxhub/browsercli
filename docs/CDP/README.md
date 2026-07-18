# Chrome DevTools Protocol Reference

This directory contains the documentation for Chrome DevTools Protocol (CDP), automatically generated from the JSON definitions.

## Domains

| Domain | Source | Experimental/Deprecated | Description |
| --- | --- | --- | --- |
| [Accessibility](Accessibility.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [Ads](Ads.md) | Browser Protocol (Chromium) | `🧪 experimental` | A domain for ad-related metrics and data. |
| [Animation](Animation.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [Audits](Audits.md) | Browser Protocol (Chromium) | `🧪 experimental` | Audits domain allows investigation of page violations and possible improvements. |
| [Autofill](Autofill.md) | Browser Protocol (Chromium) | `🧪 experimental` | Defines commands and events for Autofill. |
| [BackgroundService](BackgroundService.md) | Browser Protocol (Chromium) | `🧪 experimental` | Defines events for background web platform features. |
| [BluetoothEmulation](BluetoothEmulation.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain allows configuring virtual Bluetooth devices to test<br/>the web-bluetooth API. |
| [Browser](Browser.md) | Browser Protocol (Chromium) | _Standard_ | The Browser domain defines methods and events for browser managing. |
| [CacheStorage](CacheStorage.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [Cast](Cast.md) | Browser Protocol (Chromium) | `🧪 experimental` | A domain for interacting with Cast, Presentation API, and Remote Playback API<br/>functionalities. |
| [Console](Console.md) | JS Protocol (V8) | `⚠️ deprecated` | This domain is deprecated - use Runtime or Log instead. |
| [CrashReportContext](CrashReportContext.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain exposes the current state of the CrashReportContext API. |
| [CSS](CSS.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain exposes CSS read/write operations. All CSS objects (stylesheets, rules, and styles)<br/>have an associated `id` used in subsequent operations on the related object. Each object type has<br/>a specific `id` structure, and those are not interchangeable between objects of different kinds.<br/>CSS objects can be loaded using the `get*ForNode()` calls (which accept a DOM node id). A client<br/>can also keep track of stylesheets via the `styleSheetAdded`/`styleSheetRemoved` events and<br/>subsequently load the required stylesheet contents using the `getStyleSheet[Text]()` methods. |
| [Debugger](Debugger.md) | JS Protocol (V8) | _Standard_ | Debugger domain exposes JavaScript debugging capabilities. It allows setting and removing<br/>breakpoints, stepping through execution, exploring stack traces, etc. |
| [DeviceAccess](DeviceAccess.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [DeviceOrientation](DeviceOrientation.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [DigitalCredentials](DigitalCredentials.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain allows interacting with the Digital Credentials API for automation. |
| [DOM](DOM.md) | Browser Protocol (Chromium) | _Standard_ | This domain exposes DOM read/write operations. Each DOM Node is represented with its mirror object<br/>that has an `id`. This `id` can be used to get additional information on the Node, resolve it into<br/>the JavaScript object wrapper, etc. It is important that client receives DOM events only for the<br/>nodes that are known to the client. Backend keeps track of the nodes that were sent to the client<br/>and never sends the same node twice. It is client's responsibility to collect information about<br/>the nodes that were sent to the client. Note that `iframe` owner elements will return<br/>corresponding document elements as their child nodes. |
| [DOMDebugger](DOMDebugger.md) | Browser Protocol (Chromium) | _Standard_ | DOM debugging allows setting breakpoints on particular DOM operations and events. JavaScript<br/>execution will stop on these operations as if there was a regular breakpoint set. |
| [DOMSnapshot](DOMSnapshot.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain facilitates obtaining document snapshots with DOM, layout, and style information. |
| [DOMStorage](DOMStorage.md) | Browser Protocol (Chromium) | `🧪 experimental` | Query and modify DOM storage. |
| [Emulation](Emulation.md) | Browser Protocol (Chromium) | _Standard_ | This domain emulates different environments for the page. |
| [EventBreakpoints](EventBreakpoints.md) | Browser Protocol (Chromium) | `🧪 experimental` | EventBreakpoints permits setting JavaScript breakpoints on operations and events<br/>occurring in native code invoked from JavaScript. Once breakpoint is hit, it is<br/>reported through Debugger domain, similarly to regular breakpoints being hit. |
| [Extensions](Extensions.md) | Browser Protocol (Chromium) | `🧪 experimental` | Defines commands and events for browser extensions. |
| [FedCm](FedCm.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain allows interacting with the FedCM dialog. |
| [Fetch](Fetch.md) | Browser Protocol (Chromium) | _Standard_ | A domain for letting clients substitute browser's network layer with client code. |
| [FileSystem](FileSystem.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [HeadlessExperimental](HeadlessExperimental.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain provides experimental commands only supported in headless mode. |
| [HeapProfiler](HeapProfiler.md) | JS Protocol (V8) | `🧪 experimental` |  |
| [IndexedDB](IndexedDB.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [Input](Input.md) | Browser Protocol (Chromium) | _Standard_ |  |
| [Inspector](Inspector.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [IO](IO.md) | Browser Protocol (Chromium) | _Standard_ | Input/Output operations for streams produced by DevTools. |
| [LayerTree](LayerTree.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [Log](Log.md) | Browser Protocol (Chromium) | _Standard_ | Provides access to log entries. |
| [Media](Media.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain allows detailed inspection of media elements. |
| [Memory](Memory.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [Network](Network.md) | Browser Protocol (Chromium) | _Standard_ | Network domain allows tracking network activities of the page. It exposes information about http,<br/>file, data and other requests and responses, their headers, bodies, timing, etc. |
| [Overlay](Overlay.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain provides various functionality related to drawing atop the inspected page. |
| [Page](Page.md) | Browser Protocol (Chromium) | _Standard_ | Actions and events related to the inspected page belong to the page domain. |
| [Performance](Performance.md) | Browser Protocol (Chromium) | _Standard_ |  |
| [PerformanceTimeline](PerformanceTimeline.md) | Browser Protocol (Chromium) | `🧪 experimental` | Reporting of performance timeline events, as specified in<br/>https://w3c.github.io/performance-timeline/#dom-performanceobserver. |
| [Preload](Preload.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [Profiler](Profiler.md) | JS Protocol (V8) | _Standard_ |  |
| [PWA](PWA.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain allows interacting with the browser to control PWAs. |
| [Runtime](Runtime.md) | JS Protocol (V8) | _Standard_ | Runtime domain exposes JavaScript runtime by means of remote evaluation and mirror objects.<br/>Evaluation results are returned as mirror object that expose object type, string representation<br/>and unique identifier that can be used for further object reference. Original objects are<br/>maintained in memory unless they are either explicitly released or are released along with the<br/>other objects in their object group. |
| [Schema](Schema.md) | JS Protocol (V8) | `⚠️ deprecated` | This domain is deprecated. |
| [Security](Security.md) | Browser Protocol (Chromium) | _Standard_ |  |
| [ServiceWorker](ServiceWorker.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [SmartCardEmulation](SmartCardEmulation.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [Storage](Storage.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |
| [SystemInfo](SystemInfo.md) | Browser Protocol (Chromium) | `🧪 experimental` | The SystemInfo domain defines methods and events for querying low-level system information. |
| [Target](Target.md) | Browser Protocol (Chromium) | _Standard_ | Supports additional targets discovery and allows to attach to them. |
| [Tethering](Tethering.md) | Browser Protocol (Chromium) | `🧪 experimental` | The Tethering domain defines methods and events for browser port binding. |
| [Tracing](Tracing.md) | Browser Protocol (Chromium) | _Standard_ |  |
| [WebAudio](WebAudio.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain allows inspection of Web Audio API.<br/>https://webaudio.github.io/web-audio-api/ |
| [WebAuthn](WebAuthn.md) | Browser Protocol (Chromium) | `🧪 experimental` | This domain allows configuring virtual authenticators to test the WebAuthn<br/>API. |
| [WebMCP](WebMCP.md) | Browser Protocol (Chromium) | `🧪 experimental` |  |


---
*Documentation generated on 2026-07-09T10:43:19.973Z*