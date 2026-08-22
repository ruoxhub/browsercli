// External script with a named function and a SourceMap reference.
function fixtureAdd(a, b) {
  return a + b;
}

function fixtureFetch() {
  return fetch('/api/data').then(response => response.json());
}

window.fixtureAdd = fixtureAdd;
window.fixtureFetch = fixtureFetch;
//# sourceMappingURL=app.js.map