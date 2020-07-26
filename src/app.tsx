import * as React from "react";
import { Gitlab } from "gitlab";
import { throttle, cloneDeep, orderBy } from "lodash";
import Collapsible from "react-collapsible";
import classNames from "classnames";
import * as icons from "./icons";

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      let encoded = reader.result.toString().replace(/^data:(.*,)?/, "");
      if (encoded.length % 4 > 0) {
        encoded += "=".repeat(4 - (encoded.length % 4));
      }
      resolve(encoded);
    };
    reader.onerror = (error) => reject(error);
  });

type CustomCollapsible = {
  openCollapsible: Function;
  state: { isClosed: boolean };
};

type RepositoryResult = {
  id: string;
  mode: string;
  name: string;
  path: string;
  type: "blob" | "tree";
};

interface CommitAction {
  action: "create" | "delete" | "move" | "update";
  filePath: string;
  previousPath?: string;
  content?: string;
  encoding?: string;
  lastCommitId?: string;
}

type RepositoryFile = {
  id: string;
  mode: string;
  name: string;
  path: string;
  type: "blob" | "tree";
  parent: string;
  children: RepositoryFile[];
  new: Boolean;
  delete: Boolean;
  data?: File;
};

type FileMap = { [key: string]: RepositoryFile };

interface State {
  tree: RepositoryFile[];
  changes: boolean;
  message: string;
  actions: CommitAction[];
}

interface Props {
  appId: string;
  redirectUrl: string;
  repositoryPath: string;
  rootPath: string;
}

class App extends React.Component<Props, State> {
  authToken?: string;
  expires?: number;
  api: Gitlab;
  map: FileMap = {};
  originalMap: FileMap = {};
  collapsers: {
    [key: string]: CustomCollapsible;
  } = {};

  constructor(props) {
    super(props);

    this.state = {
      tree: null,
      changes: false,
      message: "",
      actions: [],
    };
  }

  createTree = (map: FileMap): void => {
    const tree = [];
    let changes = false;
    Object.entries(map).forEach(([id, node]) => {
      node.children = [];
      if (node.parent) {
        this.map[node.parent].children.push(node);
      } else {
        tree.push(node);
      }
      if (
        (node.new || node.delete) &&
        node.id !== "__temporary-placeholder__"
      ) {
        changes = true;
      }
    });
    this.setState({ tree, changes });
  };

  fetchFiles = async () => {
    if (!this.props.repositoryPath) {
      return;
    }

    this.map = {};

    let results = (await this.api.Repositories.tree(this.props.repositoryPath, {
      recursive: true,
      path: this.props.rootPath,
    })) as RepositoryResult[];

    results.forEach((r) => {
      const path = r.path.replace(`${this.props.rootPath}/`, "");
      this.map[path] = {
        ...r,
        path: path,
        children: [],
        parent: path.split("/").slice(0, -1).join("/"),
        new: false,
        delete: false,
      };
    });
    this.originalMap = cloneDeep(this.map);

    this.createTree(this.map);
  };

  componentDidMount() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const currTime = new Date().getTime() / 1000;
    window.location.hash = "";

    this.authToken = localStorage.getItem("auth_token");
    this.expires = (localStorage.getItem("expires") as unknown) as number;

    if (this.authToken && (!this.expires || this.expires > currTime)) {
      // Have access token
      this.api = new Gitlab({ oauthToken: this.authToken });
    } else if (params.get("access_token")) {
      // Just redirected from OAuth
      localStorage.setItem("auth_token", params.get("access_token"));
      if (params.get("expires_in")) {
        localStorage.setItem("expires", currTime + params.get("expires_in"));
      }
    } else {
      // Need to redirect from OAuth
      window.location.href = `https://gitlab.com/oauth/authorize?client_id=${this.props.appId}&redirect_uri=${this.props.redirectUrl}&scope=api&response_type=token`;
    }

    ["drop", "dragover", "dragenter"].forEach((event) =>
      window.addEventListener(
        event,
        (e) => {
          e.preventDefault();
          e.stopPropagation();
        },
        false
      )
    );

    this.fetchFiles();
  }

  openFileDialog = (e: React.MouseEvent<any>, path: string) => {
    e.stopPropagation();
    (this.refs.fileInput as HTMLElement).dataset.path = path;
    (this.refs.fileInput as HTMLElement).click();
  };

  handleDrop = (e: React.DragEvent, parent: string) => {
    this.removeTempPlaceholder();
    this.createFiles(e.dataTransfer.files, parent);
  };

  handleFileInput = (e: React.ChangeEvent) => {
    const parent = (this.refs.fileInput as HTMLElement).dataset.path;
    this.createFiles((e.target as HTMLInputElement).files, parent);
  };

  createFolder = (e, name: string = "test", parent: string) => {
    e.stopPropagation();
    const path = `${parent ? `${parent}/` : ""}${name}`;
    this.map[path] = {
      id: `upload-folder-${name}`,
      mode: "",
      name: name,
      path,
      type: "tree",
      children: [],
      parent,
      new: true,
      delete: false,
    };
    this.createTree(this.map);
  };

  createFiles = (files: FileList, parent: string) => {
    Array.from(files).forEach((file) => {
      const path = `${parent ? `${parent}/` : ""}${file.name}`;
      this.map[path] = {
        id: `upload-${file.name}`,
        mode: "",
        name: file.name,
        path,
        type: "blob",
        children: [],
        parent,
        new: true,
        delete: false,
        data: file,
      };
    });
    this.createTree(this.map);
  };

  removeTempPlaceholder = () => {
    delete this.map["__temporary-placeholder__"];
  };

  _handleDragOver = (e, parent) => {
    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }
    const tempPlaceholder = this.map["__temporary-placeholder__"];
    const tempPlaceholderPath = `${parent}/temporary-placeholder`;
    if (tempPlaceholder?.path === tempPlaceholderPath) return;
    this.removeTempPlaceholder();
    const collapser = this.collapsers[parent];
    if (collapser && collapser.state.isClosed) {
      collapser.openCollapsible();
    }
    this.map["__temporary-placeholder__"] = {
      id: "__temporary-placeholder__",
      mode: "",
      name: `Upload file(s) to ${parent ? `'/${parent}'` : "root"}`,
      path: tempPlaceholderPath,
      type: "blob",
      children: [],
      parent,
      new: true,
      delete: false,
    };
    this.createTree(this.map);
  };

  handleDragOver = throttle(this._handleDragOver, 10, {
    leading: true,
    trailing: true,
  });

  handleDragEnd = () => {
    if (this.map["__temporary-placeholder__"]) {
      this.handleDragOver.cancel();
      this.removeTempPlaceholder();
      this.createTree(this.map);
    }
  };

  deleteFile = (path) => {
    if (!this.map[path]) {
      return;
    }
    if (this.map[path].new) {
      delete this.map[path];
    } else {
      this.map[path].delete = true;
    }
    this.createTree(this.map);
  };

  undeleteFile = (path) => {
    if (!this.map[path]) {
      return;
    }
    this.map[path].delete = false;
    this.createTree(this.map);
  };

  reset = () => {
    this.map = cloneDeep(this.originalMap);
    this.createTree(this.map);
  };

  createCommit = async () => {
    const message: string[] = [];
    const actions: CommitAction[] = [];
    for (const file of Object.values(this.map)) {
      if (file.delete) {
        message.push(`Delete: ${this.props.rootPath}/${file.path}`);
        actions.push({
          action: "delete",
          filePath: `${this.props.rootPath}/${file.path}`,
        });
      } else if (file.new) {
        message.push(`Create: ${this.props.rootPath}/${file.path}`);
        actions.push({
          action: "create",
          filePath: `${this.props.rootPath}/${file.path}`,
          content: await toBase64(file.data),
          encoding: "base64",
        });
      }
    }
    this.setState({ actions, message: message.sort().join("\n") });
  };

  cancelCommit = () => this.setState({ message: "", actions: [] });

  commit = async () => {
    const response = await this.api.Commits.create(
      this.props.repositoryPath,
      "master",
      this.state.message,
      this.state.actions
    );
    this.setState({ message: "", actions: [] });
    this.fetchFiles();
  };

  renderFolderName = (file: RepositoryFile) => (
    <a
      href="#"
      className="folder"
      onDragOver={(e) => this.handleDragOver(e.nativeEvent, file.path)}
      onDrop={(e) => this.handleDrop(e, file.path)}
    >
      {icons.chevronDown("bold rotate", { style: { padding: "0 8px 0 8px " } })}
      <span>{file.name}</span>
      {icons.filePlus("", {
        onClick: (e) => this.openFileDialog(e, file.path),
        style: { padding: "0 8px 0 8px ", marginLeft: "auto" },
      })}
      {icons.folderPlus("", {
        onClick: (e) => this.createFolder(e, "test", file.path),
        style: { padding: "0 8px 0 8px " },
      })}
    </a>
  );

  renderFileName = (file: RepositoryFile) => (
    <div
      className={classNames("file", { new: file.new, delete: file.delete })}
      key={file.path}
      onDragOver={(e) => this.handleDragOver(e.nativeEvent, file.parent)}
      onDrop={(e) => this.handleDrop(e, file.parent)}
    >
      <span>{file.name}</span>
      {file.delete
        ? icons.xCircle("", {
            onClick: () => this.undeleteFile(file.path),
            style: { padding: "0 8px 0 8px ", marginLeft: "auto" },
          })
        : icons.trash("", {
            onClick: () => this.deleteFile(file.path),
            style: { padding: "0 8px 0 8px ", marginLeft: "auto" },
          })}
    </div>
  );

  renderFiles = (files: RepositoryFile[]) => {
    if (!files.length) return null;
    return orderBy(files, "type", "desc").map((file) =>
      file.type === "tree" ? (
        <Collapsible
          key={file.path}
          trigger={this.renderFolderName(file)}
          ref={(ref) =>
            (this.collapsers[file.path] = (ref as unknown) as CustomCollapsible)
          }
        >
          <div className="level">{this.renderFiles(file.children)}</div>
        </Collapsible>
      ) : (
        this.renderFileName(file)
      )
    );
  };

  render() {
    if (!this.state.tree) {
      return null;
    }

    const fileList = (
      <>
        <main>
          <div
            className="top-level"
            onMouseLeave={this.handleDragEnd}
            onDragEnd={this.handleDragEnd}
          >
            {this.renderFiles(this.state.tree)}
          </div>
          <div className="buttons">
            <button disabled={!this.state.changes} onClick={this.reset}>
              Reset
            </button>
            <button
              disabled={!this.state.changes}
              className="primary"
              onClick={this.createCommit}
            >
              Commit
            </button>
          </div>
          <input
            onChange={this.handleFileInput}
            type="file"
            id="file"
            ref="fileInput"
            style={{ display: "none" }}
            multiple={true}
          />
          <input
            readOnly
            type="checkbox"
            className="modal"
            checked={!!this.state.actions.length}
          />
          <div>
            <div className="card fluid" style={{ overflowX: "hidden" }}>
              <label
                className="modal-close"
                onClick={this.cancelCommit}
              ></label>
              <h3 className="section">Confirmation</h3>
              <div className="section">
                <p>
                  Are you sure you want to make the following
                  changes?&nbsp;&nbsp;&nbsp;
                </p>
                <pre>{this.state.message}</pre>
              </div>
              <div className="buttons section">
                <button onClick={this.cancelCommit}>Cancel</button>
                <button className="primary" onClick={this.commit}>
                  Commit
                </button>
              </div>
            </div>
          </div>
        </main>
      </>
    );

    if (true) {
      return fileList;
    }
  }
}

export default App;
