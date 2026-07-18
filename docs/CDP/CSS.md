# CSS

`🧪 Experimental`

This domain exposes CSS read/write operations. All CSS objects (stylesheets, rules, and styles)
have an associated `id` used in subsequent operations on the related object. Each object type has
a specific `id` structure, and those are not interchangeable between objects of different kinds.
CSS objects can be loaded using the `get*ForNode()` calls (which accept a DOM node id). A client
can also keep track of stylesheets via the `styleSheetAdded`/`styleSheetRemoved` events and
subsequently load the required stylesheet contents using the `getStyleSheet[Text]()` methods.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [DOM](DOM.md), [Page](Page.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="stylesheetorigin"></a>StyleSheetOrigin

Stylesheet type: "injected" for stylesheets injected via extension, "user-agent" for user-agent
stylesheets, "inspector" for stylesheets created by the inspector (i.e. those holding the "via
inspector" rules), "regular" for regular stylesheets.

* **Type**: `string`
* **Allowed values**: `"injected"`, `"user-agent"`, `"inspector"`, `"regular"`

### <a name="pseudoelementmatches"></a>PseudoElementMatches

CSS rule collection for a single pseudo style.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `pseudoType` | [DOM.PseudoType](DOM.md#pseudotype) | Pseudo element type. |
| `pseudoIdentifier`<br/>_optional_ | `string` | Pseudo element custom ident. |
| `matches` | array of [RuleMatch](#rulematch) | Matches of CSS rules applicable to the pseudo style. |


### <a name="cssanimationstyle"></a>CSSAnimationStyle

CSS style coming from animations with the name of the animation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name`<br/>_optional_ | `string` | The name of the animation. |
| `style` | [CSSStyle](#cssstyle) | The style coming from the animation. |


### <a name="inheritedstyleentry"></a>InheritedStyleEntry

Inherited CSS rule collection from ancestor node.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `inlineStyle`<br/>_optional_ | [CSSStyle](#cssstyle) | The ancestor node's inline style, if any, in the style inheritance chain. |
| `matchedCSSRules` | array of [RuleMatch](#rulematch) | Matches of CSS rules matching the ancestor node in the style inheritance chain. |


### <a name="inheritedanimatedstyleentry"></a>InheritedAnimatedStyleEntry

Inherited CSS style collection for animated styles from ancestor node.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `animationStyles`<br/>_optional_ | array of [CSSAnimationStyle](#cssanimationstyle) | Styles coming from the animations of the ancestor, if any, in the style inheritance chain. |
| `transitionsStyle`<br/>_optional_ | [CSSStyle](#cssstyle) | The style coming from the transitions of the ancestor, if any, in the style inheritance chain. |


### <a name="inheritedpseudoelementmatches"></a>InheritedPseudoElementMatches

Inherited pseudo element matches from pseudos of an ancestor node.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `pseudoElements` | array of [PseudoElementMatches](#pseudoelementmatches) | Matches of pseudo styles from the pseudos of an ancestor node. |


### <a name="rulematch"></a>RuleMatch

Match data for a CSS rule.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `rule` | [CSSRule](#cssrule) | CSS rule in the match. |
| `matchingSelectors` | array of `integer` | Matching selector indices in the rule's selectorList selectors (0-based). |


### <a name="value"></a>Value

Data for a simple selector (these are delimited by commas in a selector list).

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | Value text. |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | Value range in the underlying resource (if available). |
| `specificity`<br/>_optional_ | [Specificity](#specificity) | `🧪 experimental` Specificity of the selector. |


### <a name="specificitycomponent"></a>SpecificityComponent `🧪 experimental`

Contribution of an individual simple selector to specificity.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | The simple selector text that contributes to specificity. |
| `a` | `integer` | The a component contribution. |
| `b` | `integer` | The b component contribution. |
| `c` | `integer` | The c component contribution. |


### <a name="specificity"></a>Specificity `🧪 experimental`

Specificity:
https://drafts.csswg.org/selectors/#specificity-rules

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `a` | `integer` | The a component, which represents the number of ID selectors. |
| `b` | `integer` | The b component, which represents the number of class selectors, attributes selectors, and<br/>pseudo-classes. |
| `c` | `integer` | The c component, which represents the number of type selectors and pseudo-elements. |
| `components`<br/>_optional_ | array of [SpecificityComponent](#specificitycomponent) | `🧪 experimental` Per-simple-selector contributions used to explain this specificity. |


### <a name="selectorlist"></a>SelectorList

Selector list data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `selectors` | array of [Value](#value) | Selectors in the list. |
| `text` | `string` | Rule selector text. |


### <a name="cssstylesheetheader"></a>CSSStyleSheetHeader

CSS stylesheet metainformation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) | The stylesheet identifier. |
| `frameId` | [Page.FrameId](Page.md#frameid) | Owner frame identifier. |
| `sourceURL` | `string` | Stylesheet resource URL. Empty if this is a constructed stylesheet created using<br/>new CSSStyleSheet() (but non-empty if this is a constructed stylesheet imported<br/>as a CSS module script). |
| `sourceMapURL`<br/>_optional_ | `string` | URL of source map associated with the stylesheet (if any). |
| `origin` | [StyleSheetOrigin](#stylesheetorigin) | Stylesheet origin. |
| `title` | `string` | Stylesheet title. |
| `ownerNode`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | The backend id for the owner node of the stylesheet. |
| `disabled` | `boolean` | Denotes whether the stylesheet is disabled. |
| `hasSourceURL`<br/>_optional_ | `boolean` | Whether the sourceURL field value comes from the sourceURL comment. |
| `isInline` | `boolean` | Whether this stylesheet is created for STYLE tag by parser. This flag is not set for<br/>document.written STYLE tags. |
| `isMutable` | `boolean` | Whether this stylesheet is mutable. Inline stylesheets become mutable<br/>after they have been modified via CSSOM API.<br/>`<link>` element's stylesheets become mutable only if DevTools modifies them.<br/>Constructed stylesheets (new CSSStyleSheet()) are mutable immediately after creation. |
| `isConstructed` | `boolean` | True if this stylesheet is created through new CSSStyleSheet() or imported as a<br/>CSS module script. |
| `startLine` | `number` | Line offset of the stylesheet within the resource (zero based). |
| `startColumn` | `number` | Column offset of the stylesheet within the resource (zero based). |
| `length` | `number` | Size of the content (in characters). |
| `endLine` | `number` | Line offset of the end of the stylesheet within the resource (zero based). |
| `endColumn` | `number` | Column offset of the end of the stylesheet within the resource (zero based). |
| `loadingFailed`<br/>_optional_ | `boolean` | `🧪 experimental` If the style sheet was loaded from a network resource, this indicates when the resource failed to load |


### <a name="cssrule"></a>CSSRule

CSS rule representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `selectorList` | [SelectorList](#selectorlist) | Rule selector data. |
| `nestingSelectors`<br/>_optional_ | array of `string` | `🧪 experimental` Array of selectors from ancestor style rules, sorted by distance from the current rule. |
| `origin` | [StyleSheetOrigin](#stylesheetorigin) | Parent stylesheet's origin. |
| `style` | [CSSStyle](#cssstyle) | Associated style declaration. |
| `originTreeScopeNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | `🧪 experimental` The BackendNodeId of the DOM node that constitutes the origin tree scope of this rule. |
| `media`<br/>_optional_ | array of [CSSMedia](#cssmedia) | Media list array (for rules involving media queries). The array enumerates media queries<br/>starting with the innermost one, going outwards. |
| `containerQueries`<br/>_optional_ | array of [CSSContainerQuery](#csscontainerquery) | `🧪 experimental` Container query list array (for rules involving container queries).<br/>The array enumerates container queries starting with the innermost one, going outwards. |
| `supports`<br/>_optional_ | array of [CSSSupports](#csssupports) | `🧪 experimental` @supports CSS at-rule array.<br/>The array enumerates @supports at-rules starting with the innermost one, going outwards. |
| `layers`<br/>_optional_ | array of [CSSLayer](#csslayer) | `🧪 experimental` Cascade layer array. Contains the layer hierarchy that this rule belongs to starting<br/>with the innermost layer and going outwards. |
| `scopes`<br/>_optional_ | array of [CSSScope](#cssscope) | `🧪 experimental` @scope CSS at-rule array.<br/>The array enumerates @scope at-rules starting with the innermost one, going outwards. |
| `ruleTypes`<br/>_optional_ | array of [CSSRuleType](#cssruletype) | `🧪 experimental` The array keeps the types of ancestor CSSRules from the innermost going outwards. |
| `startingStyles`<br/>_optional_ | array of [CSSStartingStyle](#cssstartingstyle) | `🧪 experimental` @starting-style CSS at-rule array.<br/>The array enumerates @starting-style at-rules starting with the innermost one, going outwards. |
| `navigations`<br/>_optional_ | array of [CSSNavigation](#cssnavigation) | `🧪 experimental` @navigation CSS at-rule array.<br/>The array enumerates @navigation at-rules starting with the innermost one, going outwards. |


### <a name="cssruletype"></a>CSSRuleType `🧪 experimental`

Enum indicating the type of a CSS rule, used to represent the order of a style rule's ancestors.
This list only contains rule types that are collected during the ancestor rule collection.

* **Type**: `string`
* **Allowed values**: `"MediaRule"`, `"SupportsRule"`, `"ContainerRule"`, `"LayerRule"`, `"ScopeRule"`, `"StyleRule"`, `"StartingStyleRule"`, `"NavigationRule"`

### <a name="ruleusage"></a>RuleUsage

CSS coverage information.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `startOffset` | `number` | Offset of the start of the rule (including selector) from the beginning of the stylesheet. |
| `endOffset` | `number` | Offset of the end of the rule body from the beginning of the stylesheet. |
| `used` | `boolean` | Indicates whether the rule was actually used by some element in the page. |


### <a name="sourcerange"></a>SourceRange

Text range within a resource. All numbers are zero-based.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `startLine` | `integer` | Start line of range. |
| `startColumn` | `integer` | Start column of range (inclusive). |
| `endLine` | `integer` | End line of range |
| `endColumn` | `integer` | End column of range (exclusive). |


### <a name="shorthandentry"></a>ShorthandEntry

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Shorthand name. |
| `value` | `string` | Shorthand value. |
| `important`<br/>_optional_ | `boolean` | Whether the property has "!important" annotation (implies `false` if absent). |


### <a name="csscomputedstyleproperty"></a>CSSComputedStyleProperty

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Computed style property name. |
| `value` | `string` | Computed style property value. |


### <a name="computedstyleextrafields"></a>ComputedStyleExtraFields `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `isAppearanceBase` | `boolean` | Returns whether or not this node is being rendered with base appearance,<br/>which happens when it has its appearance property set to base/base-select<br/>or it is in the subtree of an element being rendered with base appearance. |


### <a name="cssstyle"></a>CSSStyle

CSS style representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `cssProperties` | array of [CSSProperty](#cssproperty) | CSS properties in the style. |
| `shorthandEntries` | array of [ShorthandEntry](#shorthandentry) | Computed values for all shorthands found in the style. |
| `cssText`<br/>_optional_ | `string` | Style declaration text (if available). |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | Style declaration range in the enclosing stylesheet (if available). |


### <a name="cssproperty"></a>CSSProperty

CSS property declaration data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | The property name. |
| `value` | `string` | The property value. |
| `important`<br/>_optional_ | `boolean` | Whether the property has "!important" annotation (implies `false` if absent). |
| `implicit`<br/>_optional_ | `boolean` | Whether the property is implicit (implies `false` if absent). |
| `text`<br/>_optional_ | `string` | The full property text as specified in the style. |
| `parsedOk`<br/>_optional_ | `boolean` | Whether the property is understood by the browser (implies `true` if absent). |
| `disabled`<br/>_optional_ | `boolean` | Whether the property is disabled by the user (present for source-based properties only). |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | The entire property range in the enclosing style declaration (if available). |
| `longhandProperties`<br/>_optional_ | array of [CSSProperty](#cssproperty) | `🧪 experimental` Parsed longhand components of this property if it is a shorthand.<br/>This field will be empty if the given property is not a shorthand. |


### <a name="cssmedia"></a>CSSMedia

CSS media rule descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | Media query text. |
| `source` | `string` | Source of the media query: "mediaRule" if specified by a @media rule, "importRule" if<br/>specified by an @import rule, "linkedSheet" if specified by a "media" attribute in a linked<br/>stylesheet's LINK tag, "inlineSheet" if specified by a "media" attribute in an inline<br/>stylesheet's STYLE tag.<br/>Allowed values: `"mediaRule"`, `"importRule"`, `"linkedSheet"`, `"inlineSheet"` |
| `sourceURL`<br/>_optional_ | `string` | URL of the document containing the media query description. |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | The associated rule (@media or @import) header range in the enclosing stylesheet (if<br/>available). |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the stylesheet containing this object (if exists). |
| `mediaList`<br/>_optional_ | array of [MediaQuery](#mediaquery) | Array of media queries. |


### <a name="mediaquery"></a>MediaQuery

Media query descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `expressions` | array of [MediaQueryExpression](#mediaqueryexpression) | Array of media query expressions. |
| `active` | `boolean` | Whether the media query condition is satisfied. |


### <a name="mediaqueryexpression"></a>MediaQueryExpression

Media query expression descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `value` | `number` | Media query expression value. |
| `unit` | `string` | Media query expression units. |
| `feature` | `string` | Media query expression feature. |
| `valueRange`<br/>_optional_ | [SourceRange](#sourcerange) | The associated range of the value text in the enclosing stylesheet (if available). |
| `computedLength`<br/>_optional_ | `number` | Computed length of media query expression (if applicable). |


### <a name="csscontainerquery"></a>CSSContainerQuery `🧪 experimental`

CSS container query rule descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | `⚠️ deprecated` Container query text.<br/>Contains the query part without the container name for a single query.<br/>Deprecated in favor of conditionText which contains the full prelude<br/>after @container. |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | The associated rule header range in the enclosing stylesheet (if<br/>available). |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the stylesheet containing this object (if exists). |
| `name`<br/>_optional_ | `string` | Optional name for the container. |
| `physicalAxes`<br/>_optional_ | [DOM.PhysicalAxes](DOM.md#physicalaxes) | Optional physical axes queried for the container. |
| `logicalAxes`<br/>_optional_ | [DOM.LogicalAxes](DOM.md#logicalaxes) | Optional logical axes queried for the container. |
| `queriesScrollState`<br/>_optional_ | `boolean` | true if the query contains scroll-state() queries. |
| `queriesAnchored`<br/>_optional_ | `boolean` | true if the query contains anchored() queries. |
| `conditionText` | `string` | CSSContainerRule.conditionText |


### <a name="csssupports"></a>CSSSupports `🧪 experimental`

CSS Supports at-rule descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | Supports rule text. |
| `active` | `boolean` | Whether the supports condition is satisfied. |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | The associated rule header range in the enclosing stylesheet (if<br/>available). |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the stylesheet containing this object (if exists). |


### <a name="cssnavigation"></a>CSSNavigation `🧪 experimental`

CSS Navigation at-rule descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | Navigation rule text. |
| `active`<br/>_optional_ | `boolean` | Whether the navigation condition is satisfied. |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | The associated rule header range in the enclosing stylesheet (if<br/>available). |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the stylesheet containing this object (if exists). |


### <a name="cssscope"></a>CSSScope `🧪 experimental`

CSS Scope at-rule descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | Scope rule text. |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | The associated rule header range in the enclosing stylesheet (if<br/>available). |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the stylesheet containing this object (if exists). |


### <a name="csslayer"></a>CSSLayer `🧪 experimental`

CSS Layer at-rule descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | Layer name. |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | The associated rule header range in the enclosing stylesheet (if<br/>available). |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the stylesheet containing this object (if exists). |


### <a name="cssstartingstyle"></a>CSSStartingStyle `🧪 experimental`

CSS Starting Style at-rule descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `range`<br/>_optional_ | [SourceRange](#sourcerange) | The associated rule header range in the enclosing stylesheet (if<br/>available). |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the stylesheet containing this object (if exists). |


### <a name="csslayerdata"></a>CSSLayerData `🧪 experimental`

CSS Layer data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Layer name. |
| `subLayers`<br/>_optional_ | array of [CSSLayerData](#csslayerdata) | Direct sub-layers |
| `order` | `number` | Layer order. The order determines the order of the layer in the cascade order.<br/>A higher number has higher priority in the cascade order. |


### <a name="platformfontusage"></a>PlatformFontUsage

Information about amount of glyphs that were rendered with given font.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `familyName` | `string` | Font's family name reported by platform. |
| `postScriptName` | `string` | Font's PostScript name reported by platform. |
| `isCustomFont` | `boolean` | Indicates if the font was downloaded or resolved locally. |
| `glyphCount` | `number` | Amount of glyphs that were rendered with this font. |


### <a name="fontvariationaxis"></a>FontVariationAxis

Information about font variation axes for variable fonts

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `tag` | `string` | The font-variation-setting tag (a.k.a. "axis tag"). |
| `name` | `string` | Human-readable variation name in the default language (normally, "en"). |
| `minValue` | `number` | The minimum value (inclusive) the font supports for this tag. |
| `maxValue` | `number` | The maximum value (inclusive) the font supports for this tag. |
| `defaultValue` | `number` | The default value. |


### <a name="fontface"></a>FontFace

Properties of a web font: https://www.w3.org/TR/2008/REC-CSS2-20080411/fonts.html#font-descriptions
and additional information such as platformFontFamily and fontVariationAxes.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `fontFamily` | `string` | The font-family. |
| `fontStyle` | `string` | The font-style. |
| `fontVariant` | `string` | The font-variant. |
| `fontWeight` | `string` | The font-weight. |
| `fontStretch` | `string` | The font-stretch. |
| `fontDisplay` | `string` | The font-display. |
| `unicodeRange` | `string` | The unicode-range. |
| `src` | `string` | The src. |
| `platformFontFamily` | `string` | The resolved platform font family |
| `fontVariationAxes`<br/>_optional_ | array of [FontVariationAxis](#fontvariationaxis) | Available variation settings (a.k.a. "axes"). |


### <a name="csstryrule"></a>CSSTryRule

CSS try rule representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `origin` | [StyleSheetOrigin](#stylesheetorigin) | Parent stylesheet's origin. |
| `style` | [CSSStyle](#cssstyle) | Associated style declaration. |


### <a name="csspositiontryrule"></a>CSSPositionTryRule

CSS @position-try rule representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | [Value](#value) | The prelude dashed-ident name |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `origin` | [StyleSheetOrigin](#stylesheetorigin) | Parent stylesheet's origin. |
| `style` | [CSSStyle](#cssstyle) | Associated style declaration. |
| `active` | `boolean` |  |


### <a name="csskeyframesrule"></a>CSSKeyframesRule

CSS keyframes rule representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `animationName` | [Value](#value) | Animation name. |
| `keyframes` | array of [CSSKeyframeRule](#csskeyframerule) | List of keyframes. |


### <a name="csspropertyregistration"></a>CSSPropertyRegistration

Representation of a custom property registration through CSS.registerProperty

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `propertyName` | `string` |  |
| `initialValue`<br/>_optional_ | [Value](#value) |  |
| `inherits` | `boolean` |  |
| `syntax` | `string` |  |


### <a name="cssatrule"></a>CSSAtRule

CSS generic @rule representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Type of at-rule.<br/>Allowed values: `"font-face"`, `"font-feature-values"`, `"font-palette-values"`, `"counter-style"` |
| `subsection`<br/>_optional_ | `string` | Subsection of font-feature-values, if this is a subsection.<br/>Allowed values: `"swash"`, `"annotation"`, `"ornaments"`, `"stylistic"`, `"styleset"`, `"character-variant"` |
| `name`<br/>_optional_ | [Value](#value) | LINT.ThenChange(//third_party/blink/renderer/core/inspector/inspector_style_sheet.cc:FontVariantAlternatesFeatureType,//third_party/blink/renderer/core/inspector/inspector_css_agent.cc:FontVariantAlternatesFeatureType)<br/>Associated name, if applicable. |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `origin` | [StyleSheetOrigin](#stylesheetorigin) | Parent stylesheet's origin. |
| `style` | [CSSStyle](#cssstyle) | Associated style declaration. |


### <a name="csspropertyrule"></a>CSSPropertyRule

CSS property at-rule representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `origin` | [StyleSheetOrigin](#stylesheetorigin) | Parent stylesheet's origin. |
| `propertyName` | [Value](#value) | Associated property name. |
| `style` | [CSSStyle](#cssstyle) | Associated style declaration. |


### <a name="cssfunctionparameter"></a>CSSFunctionParameter

CSS function argument representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | The parameter name. |
| `type` | `string` | The parameter type. |


### <a name="cssfunctionconditionnode"></a>CSSFunctionConditionNode

CSS function conditional block representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `media`<br/>_optional_ | [CSSMedia](#cssmedia) | Media query for this conditional block. Only one type of condition should be set. |
| `containerQueries`<br/>_optional_ | [CSSContainerQuery](#csscontainerquery) | Container query for this conditional block. Only one type of condition should be set. |
| `supports`<br/>_optional_ | [CSSSupports](#csssupports) | @supports CSS at-rule condition. Only one type of condition should be set. |
| `navigation`<br/>_optional_ | [CSSNavigation](#cssnavigation) | @navigation condition. Only one type of condition should be set. |
| `children` | array of [CSSFunctionNode](#cssfunctionnode) | Block body. |
| `conditionText` | `string` | The condition text. |


### <a name="cssfunctionnode"></a>CSSFunctionNode

Section of the body of a CSS function rule.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `condition`<br/>_optional_ | [CSSFunctionConditionNode](#cssfunctionconditionnode) | A conditional block. If set, style should not be set. |
| `style`<br/>_optional_ | [CSSStyle](#cssstyle) | Values set by this node. If set, condition should not be set. |


### <a name="cssfunctionrule"></a>CSSFunctionRule

CSS function at-rule representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | [Value](#value) | Name of the function. |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `origin` | [StyleSheetOrigin](#stylesheetorigin) | Parent stylesheet's origin. |
| `parameters` | array of [CSSFunctionParameter](#cssfunctionparameter) | List of parameters. |
| `children` | array of [CSSFunctionNode](#cssfunctionnode) | Function body. |
| `originTreeScopeNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | `🧪 experimental` The BackendNodeId of the DOM node that constitutes the origin tree scope of this rule. |


### <a name="csskeyframerule"></a>CSSKeyframeRule

CSS keyframe rule representation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId`<br/>_optional_ | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier (absent for user agent stylesheet and user-specified<br/>stylesheet rules) this rule came from. |
| `origin` | [StyleSheetOrigin](#stylesheetorigin) | Parent stylesheet's origin. |
| `keyText` | [Value](#value) | Associated key text. |
| `style` | [CSSStyle](#cssstyle) | Associated style declaration. |


### <a name="styledeclarationedit"></a>StyleDeclarationEdit

A descriptor of operation to mutate style declaration text.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier. |
| `range` | [SourceRange](#sourcerange) | The range of the style text in the enclosing stylesheet. |
| `text` | `string` | New style text. |


---

<a name="commands"></a>
## Commands

### <a name="addrule"></a>addRule

Inserts a new rule with the given `ruleText` in a stylesheet with given `styleSheetId`, at the
position specified by `location`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) | The css style sheet identifier where a new rule should be inserted. |
| `ruleText` | `string` | The text of a new rule. |
| `location` | [SourceRange](#sourcerange) | Text position of a new rule in the target style sheet. |
| `nodeForPropertySyntaxValidation`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | `🧪 experimental` NodeId for the DOM node in whose context custom property declarations for registered properties should be<br/>validated. If omitted, declarations in the new rule text can only be validated statically, which may produce<br/>incorrect results if the declaration contains a var() for example. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `rule` | [CSSRule](#cssrule) | The newly created rule. |


### <a name="collectclassnames"></a>collectClassNames

Returns all class names from specified stylesheet.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `classNames` | array of `string` | Class name list. |


### <a name="createstylesheet"></a>createStyleSheet

Creates a new special "via-inspector" stylesheet in the frame with given `frameId`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) | Identifier of the frame where "via-inspector" stylesheet should be created. |
| `force`<br/>_optional_ | `boolean` | If true, creates a new stylesheet for every call. If false,<br/>returns a stylesheet previously created by a call with force=false<br/>for the frame's document if it exists or creates a new stylesheet<br/>(default: false). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the created "via-inspector" stylesheet. |


### <a name="disable"></a>disable

Disables the CSS agent for the given page.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables the CSS agent for the given page. Clients should not assume that the CSS agent has been
enabled until the result of this command is received.

* **Parameters**: None

* **Returns**: None


### <a name="forcepseudostate"></a>forcePseudoState

Ensures that the given node will have specified pseudo-classes whenever its style is computed by
the browser.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | The element id for which to force the pseudo state. |
| `forcedPseudoClasses` | array of `string` | Element pseudo classes to force when computing the element's style. |

* **Returns**: None


### <a name="forcestartingstyle"></a>forceStartingStyle

Ensures that the given node is in its starting-style state.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | The element id for which to force the starting-style state. |
| `forced` | `boolean` | Boolean indicating if this is on or off. |

* **Returns**: None


### <a name="getbackgroundcolors"></a>getBackgroundColors

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Id of the node to get background colors for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `backgroundColors`<br/>_optional_ | array of `string` | The range of background colors behind this element, if it contains any visible text. If no<br/>visible text is present, this will be undefined. In the case of a flat background color,<br/>this will consist of simply that color. In the case of a gradient, this will consist of each<br/>of the color stops. For anything more complicated, this will be an empty array. Images will<br/>be ignored (as if the image had failed to load). |
| `computedFontSize`<br/>_optional_ | `string` | The computed font size for this node, as a CSS computed value string (e.g. '12px'). |
| `computedFontWeight`<br/>_optional_ | `string` | The computed font weight for this node, as a CSS computed value string (e.g. 'normal' or<br/>'100'). |


### <a name="getcomputedstylefornode"></a>getComputedStyleForNode

Returns the computed style for a DOM node identified by `nodeId`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `computedStyle` | array of [CSSComputedStyleProperty](#csscomputedstyleproperty) | Computed style for the specified DOM node. |
| `extraFields` | [ComputedStyleExtraFields](#computedstyleextrafields) | `🧪 experimental` A list of non-standard "extra fields" which blink stores alongside each<br/>computed style. |


### <a name="resolvevalues"></a>resolveValues `🧪 experimental`

Resolve the specified values in the context of the provided element.
For example, a value of '1em' is evaluated according to the computed
'font-size' of the element and a value 'calc(1px + 2px)' will be
resolved to '3px'.
If the `propertyName` was specified the `values` are resolved as if
they were property's declaration. If a value cannot be parsed according
to the provided property syntax, the value is parsed using combined
syntax as if null `propertyName` was provided. If the value cannot be
resolved even then, return the provided value without any changes.
Note: this function currently does not resolve CSS random() function,
it returns unmodified random() function parts.`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `values` | array of `string` | Cascade-dependent keywords (revert/revert-layer) do not work. |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Id of the node in whose context the expression is evaluated |
| `propertyName`<br/>_optional_ | `string` | Only longhands and custom property names are accepted. |
| `pseudoType`<br/>_optional_ | [DOM.PseudoType](DOM.md#pseudotype) | Pseudo element type, only works for pseudo elements that generate<br/>elements in the tree, such as ::before and ::after. |
| `pseudoIdentifier`<br/>_optional_ | `string` | Pseudo element custom ident. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `results` | array of `string` |  |


### <a name="getlonghandproperties"></a>getLonghandProperties `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `shorthandName` | `string` |  |
| `value` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `longhandProperties` | array of [CSSProperty](#cssproperty) |  |


### <a name="getinlinestylesfornode"></a>getInlineStylesForNode

Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM
attributes) for a DOM node identified by `nodeId`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `inlineStyle`<br/>_optional_ | [CSSStyle](#cssstyle) | Inline style for the specified DOM node. |
| `attributesStyle`<br/>_optional_ | [CSSStyle](#cssstyle) | Attribute-defined element style (e.g. resulting from "width=20 height=100%"). |


### <a name="getanimatedstylesfornode"></a>getAnimatedStylesForNode `🧪 experimental`

Returns the styles coming from animations & transitions
including the animation & transition styles coming from inheritance chain.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `animationStyles`<br/>_optional_ | array of [CSSAnimationStyle](#cssanimationstyle) | Styles coming from animations. |
| `transitionsStyle`<br/>_optional_ | [CSSStyle](#cssstyle) | Style coming from transitions. |
| `inherited`<br/>_optional_ | array of [InheritedAnimatedStyleEntry](#inheritedanimatedstyleentry) | Inherited style entries for animationsStyle and transitionsStyle from<br/>the inheritance chain of the element. |


### <a name="getmatchedstylesfornode"></a>getMatchedStylesForNode

Returns requested styles for a DOM node identified by `nodeId`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `inlineStyle`<br/>_optional_ | [CSSStyle](#cssstyle) | Inline style for the specified DOM node. |
| `attributesStyle`<br/>_optional_ | [CSSStyle](#cssstyle) | Attribute-defined element style (e.g. resulting from "width=20 height=100%"). |
| `matchedCSSRules`<br/>_optional_ | array of [RuleMatch](#rulematch) | CSS rules matching this node, from all applicable stylesheets. |
| `pseudoElements`<br/>_optional_ | array of [PseudoElementMatches](#pseudoelementmatches) | Pseudo style matches for this node. |
| `inherited`<br/>_optional_ | array of [InheritedStyleEntry](#inheritedstyleentry) | A chain of inherited styles (from the immediate node parent up to the DOM tree root). |
| `inheritedPseudoElements`<br/>_optional_ | array of [InheritedPseudoElementMatches](#inheritedpseudoelementmatches) | A chain of inherited pseudo element styles (from the immediate node parent up to the DOM tree root). |
| `cssKeyframesRules`<br/>_optional_ | array of [CSSKeyframesRule](#csskeyframesrule) | A list of CSS keyframed animations matching this node. |
| `cssPositionTryRules`<br/>_optional_ | array of [CSSPositionTryRule](#csspositiontryrule) | A list of CSS @position-try rules matching this node, based on the position-try-fallbacks property. |
| `activePositionFallbackIndex`<br/>_optional_ | `integer` | Index of the active fallback in the applied position-try-fallback property,<br/>will not be set if there is no active position-try fallback. |
| `cssPropertyRules`<br/>_optional_ | array of [CSSPropertyRule](#csspropertyrule) | A list of CSS at-property rules matching this node. |
| `cssPropertyRegistrations`<br/>_optional_ | array of [CSSPropertyRegistration](#csspropertyregistration) | A list of CSS property registrations matching this node. |
| `cssAtRules`<br/>_optional_ | array of [CSSAtRule](#cssatrule) | A list of simple @rules matching this node or its pseudo-elements. |
| `parentLayoutNodeId`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | `🧪 experimental` Id of the first parent element that does not have display: contents. |
| `cssFunctionRules`<br/>_optional_ | array of [CSSFunctionRule](#cssfunctionrule) | `🧪 experimental` A list of CSS at-function rules referenced by styles of this node. |


### <a name="getenvironmentvariables"></a>getEnvironmentVariables `🧪 experimental`

Returns the values of the default UA-defined environment variables used in env()

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `environmentVariables` | `object` |  |


### <a name="getmediaqueries"></a>getMediaQueries

Returns all media queries parsed by the rendering engine.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `medias` | array of [CSSMedia](#cssmedia) |  |


### <a name="getplatformfontsfornode"></a>getPlatformFontsForNode

Requests information about platform fonts which we used to render child TextNodes in the given
node.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `fonts` | array of [PlatformFontUsage](#platformfontusage) | Usage statistics for every employed platform font. |


### <a name="getstylesheettext"></a>getStyleSheetText

Returns the current textual content for a stylesheet.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | The stylesheet text. |


### <a name="getlayersfornode"></a>getLayersForNode `🧪 experimental`

Returns all layers parsed by the rendering engine for the tree scope of a node.
Given a DOM element identified by nodeId, getLayersForNode returns the root
layer for the nearest ancestor document or shadow root. The layer root contains
the full layer tree for the tree scope and their ordering.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `rootLayer` | [CSSLayerData](#csslayerdata) |  |


### <a name="getlocationforselector"></a>getLocationForSelector `🧪 experimental`

Given a CSS selector text and a style sheet ID, getLocationForSelector
returns an array of locations of the CSS selector in the style sheet.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `selectorText` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `ranges` | array of [SourceRange](#sourcerange) |  |


### <a name="trackcomputedstyleupdatesfornode"></a>trackComputedStyleUpdatesForNode `🧪 experimental`

Starts tracking the given node for the computed style updates
and whenever the computed style is updated for node, it queues
a `computedStyleUpdated` event with throttling.
There can only be 1 node tracked for computed style updates
so passing a new node id removes tracking from the previous node.
Pass `undefined` to disable tracking.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) |  |

* **Returns**: None


### <a name="trackcomputedstyleupdates"></a>trackComputedStyleUpdates `🧪 experimental`

Starts tracking the given computed styles for updates. The specified array of properties
replaces the one previously specified. Pass empty array to disable tracking.
Use takeComputedStyleUpdates to retrieve the list of nodes that had properties modified.
The changes to computed style properties are only tracked for nodes pushed to the front-end
by the DOM agent. If no changes to the tracked properties occur after the node has been pushed
to the front-end, no updates will be issued for the node.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `propertiesToTrack` | array of [CSSComputedStyleProperty](#csscomputedstyleproperty) |  |

* **Returns**: None


### <a name="takecomputedstyleupdates"></a>takeComputedStyleUpdates `🧪 experimental`

Polls the next batch of computed style updates.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [DOM.NodeId](DOM.md#nodeid) | The list of node Ids that have their tracked computed styles updated. |


### <a name="seteffectivepropertyvaluefornode"></a>setEffectivePropertyValueForNode

Find a rule with the given active property for the given node and set the new value for this
property

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | The element id for which to set property. |
| `propertyName` | `string` |  |
| `value` | `string` |  |

* **Returns**: None


### <a name="setpropertyrulepropertyname"></a>setPropertyRulePropertyName

Modifies the property rule property name.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `propertyName` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `propertyName` | [Value](#value) | The resulting key text after modification. |


### <a name="setkeyframekey"></a>setKeyframeKey

Modifies the keyframe rule key text.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `keyText` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `keyText` | [Value](#value) | The resulting key text after modification. |


### <a name="setmediatext"></a>setMediaText

Modifies the rule selector.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `text` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `media` | [CSSMedia](#cssmedia) | The resulting CSS media rule after modification. |


### <a name="setcontainerquerytext"></a>setContainerQueryText `🧪 experimental` `⚠️ deprecated`

Modifies the expression of a container query.
Deprecated. Use setContainerQueryConditionText instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `text` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `containerQuery` | [CSSContainerQuery](#csscontainerquery) | The resulting CSS container query rule after modification. |


### <a name="setcontainerqueryconditiontext"></a>setContainerQueryConditionText `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `text` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `containerQuery` | [CSSContainerQuery](#csscontainerquery) | The resulting CSS container query rule after modification. |


### <a name="setsupportstext"></a>setSupportsText `🧪 experimental`

Modifies the expression of a supports at-rule.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `text` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `supports` | [CSSSupports](#csssupports) | The resulting CSS Supports rule after modification. |


### <a name="setnavigationtext"></a>setNavigationText `🧪 experimental`

Modifies the expression of a navigation at-rule.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `text` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `navigation` | [CSSNavigation](#cssnavigation) | The resulting CSS Navigation rule after modification. |


### <a name="setscopetext"></a>setScopeText `🧪 experimental`

Modifies the expression of a scope at-rule.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `text` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `scope` | [CSSScope](#cssscope) | The resulting CSS Scope rule after modification. |


### <a name="setruleselector"></a>setRuleSelector

Modifies the rule selector.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `range` | [SourceRange](#sourcerange) |  |
| `selector` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `selectorList` | [SelectorList](#selectorlist) | The resulting selector list after modification. |


### <a name="setstylesheettext"></a>setStyleSheetText

Sets the new stylesheet text.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |
| `text` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `sourceMapURL`<br/>_optional_ | `string` | URL of source map associated with script (if any). |


### <a name="setstyletexts"></a>setStyleTexts

Applies specified style edits one after another in the given order.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `edits` | array of [StyleDeclarationEdit](#styledeclarationedit) |  |
| `nodeForPropertySyntaxValidation`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | `🧪 experimental` NodeId for the DOM node in whose context custom property declarations for registered properties should be<br/>validated. If omitted, declarations in the new rule text can only be validated statically, which may produce<br/>incorrect results if the declaration contains a var() for example. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `styles` | array of [CSSStyle](#cssstyle) | The resulting styles after modification. |


### <a name="startruleusagetracking"></a>startRuleUsageTracking

Enables the selector recording.

* **Parameters**: None

* **Returns**: None


### <a name="stopruleusagetracking"></a>stopRuleUsageTracking

Stop tracking rule usage and return the list of rules that were used since last call to
`takeCoverageDelta` (or since start of coverage instrumentation).

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `ruleUsage` | array of [RuleUsage](#ruleusage) |  |


### <a name="takecoveragedelta"></a>takeCoverageDelta

Obtain list of rules that became used since last call to this method (or since start of coverage
instrumentation).

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `coverage` | array of [RuleUsage](#ruleusage) |  |
| `timestamp` | `number` | Monotonically increasing time, in seconds. |


### <a name="setlocalfontsenabled"></a>setLocalFontsEnabled `🧪 experimental`

Enables/disables rendering of local CSS fonts (enabled by default).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether rendering of local fonts is enabled. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="fontsupdated"></a>fontsUpdated

Fires whenever a web font is updated.  A non-empty font parameter indicates a successfully loaded
web font.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `font`<br/>_optional_ | [FontFace](#fontface) | The web font that has loaded. |


### <a name="mediaqueryresultchanged"></a>mediaQueryResultChanged

Fires whenever a MediaQuery result changes (for example, after a browser window has been
resized.) The current implementation considers only viewport-dependent media features.

* **Parameters**: None


### <a name="stylesheetadded"></a>styleSheetAdded

Fired whenever an active document stylesheet is added.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `header` | [CSSStyleSheetHeader](#cssstylesheetheader) | Added stylesheet metainfo. |


### <a name="stylesheetchanged"></a>styleSheetChanged

Fired whenever a stylesheet is changed as a result of the client operation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) |  |


### <a name="stylesheetremoved"></a>styleSheetRemoved

Fired whenever an active document stylesheet is removed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `styleSheetId` | [DOM.StyleSheetId](DOM.md#stylesheetid) | Identifier of the removed stylesheet. |


### <a name="computedstyleupdated"></a>computedStyleUpdated `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | The node id that has updated computed styles. |


