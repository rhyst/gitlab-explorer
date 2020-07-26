import css from "bundle-text:./src/app.less";
import vendorCss from "bundle-text:./src/vendor.css";
import * as React from "react";
import ReactDOM from "react-dom";
import App from "./src/app";

class GitlabExplorer extends HTMLElement {
  rendered = false;
  root = null;

  static get observedAttributes() {
    return ["app-id", "redirect-url", "repository-path", "root-path"];
  }

  constructor() {
    super();

    let shadow = this.attachShadow({ mode: "open" });

    let style = document.createElement("style");
    style.textContent = vendorCss + "\n" + css;
    shadow.appendChild(style);

    this.root = document.createElement("span");
    shadow.appendChild(this.root);

    Object.defineProperty(this.root, "ownerDocument", { value: shadow });
    shadow.createElement = (...args) => document.createElement(...args);
    shadow.createElementNS = (...args) => document.createElementNS(...args);
    shadow.createTextNode = (...args) => document.createTextNode(...args);

    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const appId = this.getAttribute("app-id");
    const redirectUrl = this.getAttribute("redirect-url");
    const repositoryPath = this.getAttribute("repository-path");
    const rootPath = this.getAttribute("root-path");

    if (!this.rendered && appId && redirectUrl && repositoryPath && rootPath) {
      ReactDOM.render(
        <App
          appId={appId}
          redirectUrl={redirectUrl}
          repositoryPath={repositoryPath}
          rootPath={rootPath}
        />,
        this.root
      );
    }
  }
}

customElements.define("gitlab-explorer", GitlabExplorer);
