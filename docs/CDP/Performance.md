# Performance

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

### <a name="metric"></a>Metric

Run-time execution metric.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Metric name. |
| `value` | `number` | Metric value. |


---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

Disable collecting and reporting metrics.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enable collecting and reporting metrics.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `timeDomain`<br/>_optional_ | `string` | Time domain to use for collecting and reporting duration metrics.<br/>Allowed values: `"timeTicks"`, `"threadTicks"` |

* **Returns**: None


### <a name="settimedomain"></a>setTimeDomain `🧪 experimental` `⚠️ deprecated`

Sets time domain to use for collecting and reporting duration metrics.
Note that this must be called before enabling metrics collection. Calling
this method while metrics collection is enabled returns an error.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `timeDomain` | `string` | Time domain<br/>Allowed values: `"timeTicks"`, `"threadTicks"` |

* **Returns**: None


### <a name="getmetrics"></a>getMetrics

Retrieve current values of run-time metrics.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `metrics` | array of [Metric](#metric) | Current values for run-time metrics. |


---

<a name="events"></a>
## Events

### <a name="metrics"></a>metrics

Current values of the metrics.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `metrics` | array of [Metric](#metric) | Current values of the metrics. |
| `title` | `string` | Timestamp title. |


