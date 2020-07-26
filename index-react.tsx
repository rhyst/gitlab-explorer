import * as React from "react";
import { render } from "react-dom";
import App from "./src/app";
import "./src/app.less";
import "./src/vendor.css";

render(
  <App
    appId={process.env.APP_ID}
    redirectUrl={process.env.REDIRECT_URL}
    repositoryPath={process.env.REPOSITORY_PATH}
    rootPath={process.env.ROOT_PATH}
  />,
  document.getElementById("app")
);
