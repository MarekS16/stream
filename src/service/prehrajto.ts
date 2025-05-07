import { parseHTML } from "linkedom";

import type { Resolver, StreamDetails } from "../getTopItems.ts";
import type { SearchResult } from "../getTopItems.ts";
import { sizeToBytes, timeToSeconds } from "../utils/convert.ts";
import { extractCookies, headerCookies } from "../utils/cookies.ts";
import commonHeaders, { type FetchOptions } from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  cookie: "AC=C",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  Referer: "https://prehraj.to/",
};

/**
 * Get headers for authenticated response

 */
async function login(userName: string, password: string) {
  if (!userName) {
    return loginAnonymous();
  }
  const r1 = await fetch("https://prehraj.to/?login-gtm_action=login", {
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
    body: `email=${encodeURIComponent(userName)}&password=${encodeURIComponent(
      password,
    )}&remember=on&_submit=P%C5%99ihl%C3%A1sit+se&_do=login-loginForm-submit`,
    method: "POST",
  });
  const cookies = extractCookies(r1);

  return {
    headers: headerCookies(cookies),
  };
}

async function loginAnonymous() {
  const result = await fetch("https://prehraj.to/", {
    headers: {
      ...headers,
      Referer: "https://prehraj.to/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    method: "GET",
  });

  const cookies = extractCookies(result);

  return {
    headers: headerCookies(cookies),
  };
}

const fetchOptionsCache = new Map();
/**
 * Get headers for authenticated response
 */
async function getFetchOptions(userName: string, password: string) {
  const cacheKey = `${userName}:${password}`;
  const fetchOptions = fetchOptionsCache.get(cacheKey);
  if (fetchOptions) {
    return fetchOptions;
  }

  const newFetchOptions = await login(userName, password);
  fetchOptionsCache.set(cacheKey, newFetchOptions);
  return newFetchOptions;
}

async function getResultStreamUrls(
  result: SearchResult,
  fetchOptions: FetchOptions = {},
): Promise<StreamDetails> {
  const detailPageUrl = result.detailPageUrl;
  const pageResponse = await fetch(detailPageUrl, {
    ...fetchOptions,
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    body: null,
    method: "GET",
  });
  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);

  const scriptEls = document.querySelectorAll("script");
  const scriptEl = [...scriptEls].find((el) =>
    el.textContent.includes("sources ="),
  );
  const script = scriptEl.textContent;

  let video = "";
  let subtitles: { id: string; url: string; lang: string }[] = [];

  try {
    const sourcesRegex = /.*var sources\s*=\s*(\[.*?\])\s*;/s;
    const sources = sourcesRegex.exec(script)[1];
    const items = eval(sources);
    video = items.pop().file;
  } catch (error) {
    console.log("error parsing streams", error);
    const srcRegex = /.*src:\s*"(.*?)".*/s;
    video = srcRegex.exec(script)[1];
  }

  try {
    const sourcesRegex = /.*var tracks\s*=\s*(\[.*?\])\s*;/s;
    const sources = sourcesRegex.exec(script)[1];
    const items = eval(sources) as Array<{
      kind: string;
      label: string;
      src: string;
      srclang: string;
    }>;
    subtitles = items
      .filter((item) => item.kind === "captions")
      .map((item) => ({
        id: item.label,
        url: item.src,
        lang: item.srclang,
      }));
  } catch {
    // nothing to do
  }

  return {
    video,
    subtitles,
  };
}

async function getSearchResults(
  title: string,
  fetchOptions: FetchOptions = {},
) {
  const pageResponse = await fetch(
    `https://prehraj.to/hledej/${encodeURIComponent(title)}?vp-page=0`,
    {
      ...fetchOptions,
      headers: {
        ...headers,
        ...(fetchOptions.headers ?? {}),
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      body: null,
      method: "GET",
    },
  );

  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);
  const links = document.querySelectorAll("a.video--link");
  const results = [...links].map((linkEl) => {
    const path = linkEl.getAttribute("href");
    const sizeStr = linkEl
      .querySelector(".video__tag--size")
      .innerHTML.toUpperCase();

    return {
      resolverId: path,
      title: linkEl.getAttribute("title"),
      detailPageUrl: `https://prehraj.to${path}`,
      duration: timeToSeconds(
        linkEl.querySelector(".video__tag--time").innerHTML,
      ),
      format: linkEl
        .querySelector(".video__tag--format use")
        ?.getAttribute("xlink:href"), // TODO
      size: sizeToBytes(sizeStr),
    };
  });
  return results;
}

export function getResolver(): Resolver {
  return {
    resolverName: "PrehrajTo",

    init: async () => true,

    validateConfig: async (addonConfig) => {
      if (!addonConfig.prehrajtoUsername || !addonConfig.prehrajtoPassword) {
        return false;
      }
      const fetchOptions = await getFetchOptions(
        addonConfig.prehrajtoUsername,
        addonConfig.prehrajtoPassword,
      );
      return "headers" in fetchOptions;
    },

    search: async (title, addonConfig) => {
      const fetchOptions = await getFetchOptions(
        addonConfig.prehrajtoUsername,
        addonConfig.prehrajtoPassword,
      );
      return getSearchResults(title, fetchOptions);
    },

    resolve: async (searchResult, addonConfig) => {
      const fetchOptions = await getFetchOptions(
        addonConfig.prehrajtoUsername,
        addonConfig.prehrajtoPassword,
      );
      return {
        ...searchResult,
        ...(await getResultStreamUrls(searchResult, fetchOptions)),
      };
    },
  };
}
