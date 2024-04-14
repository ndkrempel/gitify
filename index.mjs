#!/usr/bin/env node
import { parseArgs, TextDecoder, promisify } from 'node:util';
import * as npath from 'node:path';
import * as fs from 'node:fs/promises';
import * as child_process from 'node:child_process';
import { JSDOM } from 'jsdom';
const exec = promisify(child_process.exec);
// TODO: Option to use pre-redirect names for resources.
const args = parseArgs({
    options: {
        'base-url': {
            short: 'b',
            type: 'string',
            default: 'https://duel.neocities.org/concentric/',
        },
        'root': {
            short: 'r',
            type: 'string',
            multiple: true,
            default: ['maze.html'],
        },
        'output-dir': {
            short: 'o',
            type: 'string',
            default: 'out',
        },
        'branch': {
            short: 'n',
            type: 'string',
            default: 'master',
        },
        'use-original-names': {
            short: 'u',
            type: 'boolean',
            default: false,
        },
        'no-git-commit': {
            short: 'g',
            type: 'boolean',
        },
        'output-manifest': {
            short: 'm',
            type: 'string',
        },
    },
});
const httpSchemes = ['http:', 'https:'];
const htmlUrlReferences = [
    { element: 'link', attribute: 'href', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'a', attribute: 'href', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'area', attribute: 'href', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'source', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'img', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'iframe', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'embed', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'video', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'video', attribute: 'poster', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'audio', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'track', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'input', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'script', attribute: 'src', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'object', attribute: 'data', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'form', attribute: 'action', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'button', attribute: 'formAction', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'blockquote', attribute: 'cite', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'ins', attribute: 'cite', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'del', attribute: 'cite', type: 0 /* HtmlUrlReferenceType.Single */ },
    { element: 'a', attribute: 'ping', type: 1 /* HtmlUrlReferenceType.SpaceSeparated */ },
    { element: 'area', attribute: 'ping', type: 1 /* HtmlUrlReferenceType.SpaceSeparated */ },
    { element: 'link', attribute: 'imageSrcset', type: 2 /* HtmlUrlReferenceType.SrcSet */ },
    { element: 'source', attribute: 'srcset', type: 2 /* HtmlUrlReferenceType.SrcSet */ },
    { element: 'img', attribute: 'srcset', type: 2 /* HtmlUrlReferenceType.SrcSet */ },
    /* Hack for Piato's weird versioning.js script. */
    { element: 'link', attribute: 'id', type: 3 /* HtmlUrlReferenceType.SingleNeedsResolving */ },
    { element: 'script', attribute: 'id', type: 3 /* HtmlUrlReferenceType.SingleNeedsResolving */ },
];
const baseUrl = (() => {
    try {
        return new URL(args.values['base-url']);
    }
    catch {
        throw new Error('Invalid base URL format');
    }
})();
if (!httpSchemes.includes(baseUrl.protocol)) {
    throw new Error('Base URL must be an HTTP URL (http:, https:)');
}
if (baseUrl.pathname.at(-1) !== '/') {
    throw new Error('Base URL must end in a slash (/)');
}
if (baseUrl.search) {
    throw new Error('Base URL must not have query parameters (?)');
}
if (baseUrl.hash) {
    throw new Error('Base URL must not have a fragment identifier (#)');
}
const seen = new Set;
const pending = [];
const outputDir = args.values['output-dir'];
const branch = args.values['branch'];
const useOriginalNames = args.values['use-original-names'];
const noGitCommit = args.values['no-git-commit'];
const outputManifest = args.values['output-manifest'];
function addLink(url, original) {
    url.search = '';
    url.hash = '';
    const path = relativeUrl(baseUrl, url);
    if (path === undefined)
        return false;
    if (seen.has(path))
        return true;
    seen.add(path);
    pending.push({ url, path, original });
    return true;
}
for (const root of args.values['root']) {
    if (!addLink(new URL(root, baseUrl))) {
        throw new Error(`Specified root "${root}" does not lie under base URL "${baseUrl}"`);
    }
}
if (noGitCommit) {
    await fs.mkdir(outputDir, { recursive: true });
}
else {
    {
        const { stdout, stderr } = await exec('git status --porcelain --untracked-files=all', { cwd: outputDir });
        if (stdout || stderr) {
            throw new Error('Target git repository is not clean');
        }
    }
    {
        const { stderr } = await exec(`git checkout --quiet ${branch}`, { cwd: outputDir });
        if (stderr) {
            throw new Error('Failed to checkout target branch');
        }
    }
    {
        const { stdout, stderr } = await exec('git status --porcelain --untracked-files=all', { cwd: outputDir });
        if (stdout || stderr) {
            throw new Error('Target git repository is not clean');
        }
    }
    {
        const { stdout, stderr } = await exec('git rm -r --ignore-unmatch .', { cwd: outputDir });
        if (stderr) {
            throw new Error('Failed to delete files in repository');
        }
    }
}
const manifest = [];
while (pending.length) {
    const target = pending.shift();
    const { url, path, original } = target;
    const response = await fetch(url, {
        credentials: 'omit',
        redirect: 'manual',
    });
    const statusCategory = Math.floor(response.status / 100);
    const location = response.headers.get('Location');
    if (statusCategory === 3 && location !== null) {
        console.log(`Redirect: "${url}" -> "${location}"`);
        addLink(new URL(location, url), original ?? target);
        continue;
    }
    if (statusCategory === 2) {
        // TODO: Refresh
        const contentType = response.headers.get('Content-Type');
        console.log(`${contentType}\t${url}`);
        const body = await response.arrayBuffer();
        const path_ = useOriginalNames && original ? original.path : path;
        manifest.push(path_);
        const localPath = npath.join(outputDir, path_.replaceAll('/', npath.sep));
        await fs.mkdir(npath.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, new Uint8Array(body));
        if (contentType === null) {
            // TODO
            console.log('No content type specified');
            continue;
        }
        const index = contentType.indexOf(';');
        const contentType_ = (~index ? contentType.slice(0, index) : contentType).trim().toLowerCase();
        switch (contentType_) {
            case 'text/html': {
                // TODO: Use appropriate character set.
                const text = new TextDecoder().decode(body);
                const links = scanHtml(url, text);
                links.forEach(_ => addLink(_));
                break;
            }
            case 'text/css': {
                // TODO: Use appropriate character set.
                const text = new TextDecoder().decode(body);
                const links = scanCss(url, text);
                links.forEach(_ => addLink(_));
                break;
            }
            case 'application/javascript': {
                // TODO: Use appropriate character set.
                const text = new TextDecoder().decode(body);
                const links = scanJavaScript(url, text);
                links.forEach(_ => addLink(_));
                break;
            }
            default: {
                // console.log(`Unknown content type "${contentType}"`);
            }
        }
        continue;
    }
    console.log(`Bad response fetching ${url}: ${response.status} ${response.statusText}`);
}
if (outputManifest) {
    await fs.writeFile(outputManifest, manifest.sort().map(_ => `${_}\n`).join(''));
}
if (!noGitCommit) {
    {
        const { stdout, stderr } = await exec('git add --all', { cwd: outputDir });
        if (stderr) {
            throw new Error('Failed to add updated files to the git index');
        }
    }
    {
        const { stdout, stderr } = await exec('git commit --all --allow-empty --message="Automatic sync by gitify"', { cwd: outputDir });
        if (stderr) {
            throw new Error('Failed to git commit');
        }
        console.log("git commit succeeded!");
        console.log(stdout);
    }
}
function scanHtml(url, body) {
    const links = [];
    const dom = new JSDOM(body, {
        url: String(url),
    });
    const document = dom.window.document;
    for (const { element, attribute, type } of htmlUrlReferences) {
        for (const elt of document.querySelectorAll(`${element}[${attribute}]`)) {
            const value = elt[attribute];
            // console.log(`${element}.${attribute}: ${value}`);
            switch (type) {
                case 0 /* HtmlUrlReferenceType.Single */: {
                    links.push(new URL(value));
                    break;
                }
                case 3 /* HtmlUrlReferenceType.SingleNeedsResolving */: {
                    /* Hack for Piato's weird versioning.js script. */
                    links.push(new URL(value, document.baseURI));
                    break;
                }
                case 1 /* HtmlUrlReferenceType.SpaceSeparated */: {
                    links.push(...value
                        .split(/[\t\n\f\r ]+/g)
                        .filter(_ => _)
                        .map(_ => new URL(_, document.baseURI)));
                    break;
                }
                case 2 /* HtmlUrlReferenceType.SrcSet */: {
                    links.push(...value
                        .split(/(?:,[\t\n\f\r ]|[\t\n\f\r ],)/g)
                        .map(_ => _.match(/^[\t\n\f\r ]*([^\t\n\f\r ]+)/))
                        .filter(_ => _)
                        .map(_ => _[1])
                        .map(_ => new URL(_, document.baseURI)));
                    break;
                }
            }
        }
    }
    return links;
    // TODO:
    // form.action (form.method)
    // button.formaction (button.formmethod)
    // script.src (script.type)
    // meta http-equiv="Refresh"
    // iframe.srcdoc
    // style contents
    // script contents
    // applet, bgsound, frame, param
    // import map
}
function scanCss(url, body) {
    const links = [];
    // TOD: Don't do replacements inside strings, urls, etc.
    // Strip comments.
    body = body.replace(/\/\*(?:[^*]|\*[^/])*(?:\*\/|$)/gsu, ' ');
    // Normalize white space.
    body = body.replace(/[ \t\n\r\f]+/gsu, ' ');
    links.push(...[...body.matchAll(/\burl\( ?((?:[^\\ )]|\\.)*|'(?:[^\\']||\\.)*'|"(?:[^\\"]||\\.)*") ?\)/gsu)]
        .map(_ => _[1])
        // .map(_ => { console.log(_); return _; })
        .map(parseString)
        .filter(_ => _ !== undefined)
        .map(_ => new URL(_, url)));
    return links;
    function parseString(string) {
        if (string.startsWith('"')) {
            if (!string.endsWith('"'))
                return;
            string = string.slice(1, -1);
        }
        else if (string.startsWith('\'')) {
            if (!string.endsWith('\''))
                return;
            string = string.slice(1, -1);
        }
        string = string.replace(/\\([0-9A-Fa-f]{1,6}) ?/gsu, (_, escape) => String.fromCodePoint(parseInt(escape, 16)));
        return string;
    }
}
function scanJavaScript(url, body) {
    const links = [];
    // TOD: Don't do replacements inside strings, templates, regexps.
    // Strip comments.
    body = body.replace(/\/(?:\/[^\n\r\u{2028}\u{2029}]*|\*(?:[^*]|\*[^/])*(?:\*\/|$))/gsu, ' ');
    // Normalize white space.
    body = body.replace(/[\t\v\f\u{feff}\p{Space_Separator}]+/gsu, ' ');
    // Normalize line terminators.
    body = body.replace(/ ?(?:[\n\r\u{2028}\u{2029}] ?)+/gsu, '\n');
    const s = String.raw `(?:^|(?<=[;\n])) ?`;
    const e = String.raw ` ?(?:$|(?=[;\n]))`;
    const b = String.raw `(?:[ \n]|\b)`;
    const identifier = String.raw `(?:(?:[\p{ID_Start}$_]|\\u[0-9A-Fa-f]{4}|\\u\{[0-9A-Fa-f]+\})(?:[\p{ID_Continue}$\u{200c}\u{200d}]|\\u[0-9A-Fa-f]{4}|\\u\{[0-9A-Fa-f]+\})*)`;
    const string = String.raw `(?:"(?:[^\\"]|\\.)*(?:"|$)|'(?:[^\\']|\\.)*(?:'|$))`;
    const importSpecifier = String.raw `(?:${identifier}|(?:${identifier}[ \n]|${string}[ \n]?)as[ \n]${identifier})`;
    const importDeclaration = new RegExp(String.raw `${s}import(?:(?:[ \n]${identifier}|(?:[ \n]${identifier}[ \n]?,)?(?:[ \n]?\*[ \n]?as[ \n]${identifier}|[ \n]?\{(?:[ \n]?${importSpecifier}[ \n]?,)*(?:[ \n]?${importSpecifier})?[ \n]?\}))${b}from)?[ \n]?(${string})${e}`, 'gsu');
    links.push(...[...body.matchAll(importDeclaration)]
        .map(_ => _[1])
        .map(parseString)
        .filter(_ => _ !== undefined)
        .map(_ => new URL(_, url)));
    // TODO: Proper lexing to handle e.g. `${``}`
    // String.raw`${backtick}(?:[^\\${backtick}$]|\$(?!\{|\\.))*(?:\$\{|${backtick}|$)`;
    const backtick = '`';
    const stringLike = String.raw `"(?:[^\\"]|\\.)*(?:"|$)|'(?:[^\\']|\\.)*(?:'|$)|${backtick}(?:[^\\${backtick}]|\\.)*(?:${backtick}|$)|(?<=(?:^|\b(?:break|case|continue|delete|do|else|finally|in|instanceof|return|throw|try|typeof|void)[ \n]?|([ \n]|\b)[+-]|[/,*!%&(:;<>?[^{|}~])[ \n]?)/(?:[^\\/[]|\\.|\[(?:[^\\\]]|\\.)*\])*/`;
    links.push(...[...body.matchAll(new RegExp(stringLike, 'gsu'))]
        .map(_ => _[0])
        .filter(_ => '"\''.includes(_[0]))
        .map(parseString)
        .filter(_ => _ !== undefined)
        .filter(_ => /\.[0-9A-Za-z]{1,4}$/iu.test(_))
        // .map(_ => { console.log(_); return _; })
        .map(_ => new URL(_, url)));
    // TODO: Use hinted referrer for URL base?
    return links;
    function parseString(string) {
        if (string.startsWith('"')) {
            if (!string.endsWith('"'))
                return;
        }
        else if (string.startsWith('\'')) {
            if (!string.endsWith('\''))
                return;
        }
        else {
            return;
        }
        string = string.slice(1, -1);
        string = string.replace(/\\(?:(?<oct>[0-3][0-7]{2}|[0-7]{1,2})|x(?<hex>[0-9A-Fa-f]{2})|u(?<unicode>[0-9A-Fa-f]{4})|u\{(?<unicode_>[0-9A-Fa-f]+)\}|(?<char>.))/gsu, (...args) => {
            const groups = args.at(-1);
            if (groups.oct !== undefined) {
                return String.fromCharCode(parseInt(groups.oct, 8));
            }
            else if (groups.hex !== undefined) {
                return String.fromCharCode(parseInt(groups.hex, 16));
            }
            else if (groups.unicode !== undefined) {
                return String.fromCharCode(parseInt(groups.unicode, 16));
            }
            else if (groups.unicode_ !== undefined) {
                return String.fromCodePoint(parseInt(groups.unicode_, 16));
            }
            else if (groups.char !== undefined) {
                switch (groups.char) {
                    case '\n': return '';
                    case 'b': return '\b';
                    case 'f': return '\f';
                    case 'n': return '\n';
                    case 'r': return '\r';
                    case 't': return '\t';
                    case 'v': return '\v';
                    default: return groups.char;
                }
            }
        });
        return string;
    }
}
function relativeUrl(baseUrl, url) {
    if (url.protocol !== baseUrl.protocol)
        return;
    if (url.username !== baseUrl.username)
        return;
    if (url.password !== baseUrl.password)
        return;
    if (url.hostname !== baseUrl.hostname)
        return;
    if (url.port !== baseUrl.port)
        return;
    const basePath = baseUrl.pathname, path = url.pathname;
    if (!path.startsWith(basePath))
        return;
    return path.slice(basePath.length);
}
