import { Address, Cell, TonClient } from "ton";
import { BN } from "bn.js";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";
import { Sha256 } from "@aws-crypto/sha256-js";
import hljs from "highlight.js/lib/core";
import hljsDefine from "highlightjs-func";
hljsDefine(hljs);

import style from "./style.css";
import { TreeFolder, TreeFile } from "./file-structure";

type Theme = "light" | "dark";
type Layout = "row" | "column";

interface GetSourcesOptions {
  verifier?: string;
  httpApiEndpoint?: string;
  httpApiKey?: string;
}

export type FuncCompilerVersion = "0.2.0" | "0.3.0";

export type FuncCompilerSettings = {
  funcVersion: FuncCompilerVersion;
  commandLine: string;
  fiftVersion: string;
  fiftlibVersion: string;
};

export interface SourcesData {
  files: { name: string; content: string }[];
  compiler: string;
  compilerSettings: FuncCompilerSettings;
  verificationDate: Date;
}

type IpfsUrlConverterFunc = (ipfsUrl: string) => string;

declare global {
  var ContractVerifier: typeof _ContractVerifier;
  var ContractVerifierUI: typeof _ContractVerifierUI;
}

const SOURCES_REGISTRY = "EQD-BJSVUJviud_Qv7Ymfd3qzXdrmV525e3YDzWQoHIAiInL";

function toSha256Buffer(s: string) {
  const sha = new Sha256();
  sha.update(s);
  return Buffer.from(sha.digestSync());
}

const _ContractVerifier = {
  getSourcesJsonUrl: async function (
    codeCellHash: string,
    options?: GetSourcesOptions
  ): Promise<string | null> {
    const tc = new TonClient({
      endpoint: options?.httpApiEndpoint ?? (await getHttpEndpoint()),
      apiKey: options?.httpApiKey,
    });

    const { stack: sourceItemAddressStack } = await tc.callGetMethod(
      Address.parse(SOURCES_REGISTRY),
      "get_source_item_address",
      [
        [
          "num",
          new BN(toSha256Buffer(options?.verifier ?? "orbs.com")).toString(),
        ],
        ["num", new BN(Buffer.from(codeCellHash, "base64")).toString(10)],
      ]
    );

    const sourceItemAddr = Cell.fromBoc(
      Buffer.from(sourceItemAddressStack[0][1].bytes, "base64")
    )[0]
      .beginParse()
      .readAddress()!;

    const isDeployed = await tc.isContractDeployed(sourceItemAddr);

    if (isDeployed) {
      const { stack: sourceItemDataStack } = await tc.callGetMethod(
        sourceItemAddr,
        "get_source_item_data"
      );
      const contentCell = Cell.fromBoc(
        Buffer.from(sourceItemDataStack[3][1].bytes, "base64")
      )[0].beginParse();
      const version = contentCell.readUintNumber(8);
      if (version !== 1) throw new Error("Unsupported version");
      const ipfsLink = contentCell.readRemainingBytes().toString();

      return ipfsLink;
    }

    return null;
  },

  getSourcesData: async function (
    sourcesJsonUrl: string,
    ipfsConverter?: IpfsUrlConverterFunc
  ): Promise<SourcesData> {
    ipfsConverter =
      ipfsConverter ??
      ((ipfs) =>
        ipfs.replace("ipfs://", "https://tonsource.infura-ipfs.io/ipfs/"));

    const verifiedContract = await (
      await fetch(ipfsConverter(sourcesJsonUrl))
    ).json();

    // TODO filename => name
    const files = await Promise.all(
      verifiedContract.sources.map(
        async (source: { url: string; filename: string }) => {
          const url = ipfsConverter(source.url);
          const content = await fetch(url).then((u) => u.text());
          return {
            name: source.filename,
            content,
          };
        }
      )
    );

    return {
      files: files.reverse(),
      verificationDate: new Date(verifiedContract.verificationDate),
      compilerSettings: verifiedContract.compilerSettings,
      compiler: verifiedContract.compiler,
    };
  },
};

export const classNames = {
  CONTAINER: "contract-verifier-container",
  FILES: "contract-verifier-files",
  FILE: "contract-verifier-file",
  FOLDER: "contract-verifier-folder",
  FOLDER_CONTAINER: "contract-verifier-folder-container",
  CONTENT: "contract-verifier-code",
};

var _ContractVerifierUI = {
  _populateCode: function (contentSelector: string, theme: "dark" | "light") {
    const codeContainer = document.querySelector(contentSelector);
    codeContainer.classList.add(classNames.CONTENT);

    const styleEl = document.createElement("style");
    styleEl.innerHTML = `${
      theme === "light"
        ? require("highlight.js/styles/atom-one-light.css").toString()
        : require("highlight.js/styles/atom-one-dark.css").toString()
    } ${style}`;
    document.head.appendChild(styleEl);

    codeContainer.innerHTML = `<pre><code class="language-func ${theme}"></code></pre>`;
  },

  _setCode: function (
    { name, content }: { name: string; content: string },
    codeWrapperEl: HTMLElement,
    filesListEl?: HTMLElement,
    fileEl?: HTMLElement
  ) {
    if (fileEl?.classList.contains("active")) return;
    codeWrapperEl.scrollTo(0, 0);
    const codeEl = codeWrapperEl.querySelector("code");
    codeEl.textContent = content;
    hljs.highlightElement(codeEl as HTMLElement);

    filesListEl
      ?.querySelector(`.${classNames.FILE}.active`)
      ?.classList.remove("active");

    fileEl?.classList.add("active");
  },

  setCode: function (contentSelector: string, content: string) {
    this._setCode(
      { name: "", content },
      document.querySelector(contentSelector)
    );
  },

  _populateFiles: function (
    fileListSelector: string,
    contentSelector: string,
    files: { name: string; content: string }[],
    theme: "dark" | "light"
  ) {
    const filePart = document.querySelector(fileListSelector);
    filePart.innerHTML = "";
    filePart.classList.add(theme);
    filePart.classList.add(classNames.FILES);

    // Prepare folder hierarchy
    const root = {
      type: "root",
      children: [],
    };

    files.forEach((file) => {
      const nameParts = Array.from(
        file.name.matchAll(/(?:\/|^)([^\/\n]+)/g)
      ).map((m) => m[1]);

      const folders =
        nameParts.length > 1 ? nameParts.slice(0, nameParts.length - 1) : [];

      let levelToPushTo = root;

      folders.forEach((folder) => {
        let existingFolder = levelToPushTo.children.find(
          (obj) => obj.type === "folder" && obj.name === folder
        );

        if (!existingFolder) {
          const newLevel = {
            type: "folder",
            name: folder,
            children: [],
          };
          levelToPushTo.children.push(newLevel);

          existingFolder = newLevel;
        }

        levelToPushTo = existingFolder;
      });

      levelToPushTo.children.push({
        type: "file",
        name: nameParts[nameParts.length - 1],
        content: file.content,
      });
    });

    function processLevel(level) {
      return level.children
        .sort((a, _) => (a.type === "file" ? -1 : 0))
        .map((child) => {
          if (child.type === "file") {
            const file = TreeFile({ name: child.name }, theme);
            file.onclick = () => {
              ContractVerifierUI._setCode(
                { name: child.name, content: child.content },
                document.querySelector(contentSelector),
                document.querySelector(fileListSelector),
                file
              );
            };
            return file;
          } else if (child.type === "folder") {
            return TreeFolder(
              { name: child.name, opened: true },
              theme,
              ...processLevel(child)
            );
          }
        });
    }

    processLevel(root).forEach((el) => filePart.appendChild(el));
  },

  _populateContainer: function (selector: string, layout?: "row" | "column") {
    const el = document.querySelector(selector);
    el.classList.add(classNames.CONTAINER);
    if (layout === "column") {
      el.classList.add("column");
    }
  },

  loadSourcesData: function (
    sourcesData: SourcesData,
    opts: {
      containerSelector: string;
      fileListSelector?: string;
      contentSelector: string;
      theme: Theme;
      layout?: Layout;
    }
  ) {
    this._populateContainer(opts.containerSelector, opts.layout);

    if (opts.fileListSelector) {
      this._populateFiles(
        opts.fileListSelector,
        opts.contentSelector,
        sourcesData.files,
        opts.theme
      );
    }
    this._populateCode(opts.contentSelector, opts.theme);
    this._setCode(
      sourcesData.files[0],
      document.querySelector(opts.contentSelector),
      document.querySelector(opts.fileListSelector),
      document.querySelector(`${opts.fileListSelector} .contract-verifier-file`) // Get first file
    );
  },
};

window.ContractVerifier = _ContractVerifier;
window.ContractVerifierUI = _ContractVerifierUI;
