(function () {
  const vscode = acquireVsCodeApi();

  document.getElementById("openGraphButton").addEventListener("click", () => {
    vscode.postMessage({ type: "openGraph" });
  });

  document.getElementById("refreshGraphButton").addEventListener("click", () => {
    vscode.postMessage({ type: "refreshGraph" });
  });
})();
