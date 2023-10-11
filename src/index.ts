import axios from "axios";
import { JSDOM } from "jsdom";
import xpath from "xpath";
import fs from "fs-extra";
import readline from "readline";
import os from "os";
import path from "path";

function emptySources() {
	return {
		main: [],
		additions: [],
		references: [],
	};
}

function getSearchUrl(text: string) {
	const transformedText = text.replaceAll(" ", "+");
	return `https://de.wiki-aventurica.de/de/index.php?search=${transformedText}&title=Spezial%3ASuche&profile=default&fulltext=1`;
}

function getFullUrl(url: string) {
	return `https://de.wiki-aventurica.de${url}`;
}

async function searchWeb(phrase: string, ruleSystem: string) {
	console.log(`Beginne Suche nach "${phrase}"`);
	const url = getSearchUrl(phrase);

	const response = await axios.get(url);
	const dom = new JSDOM(response.data);
	const document = dom.window.document;

	const searchResults = document.querySelectorAll(
		".searchresults > .mw-search-results:first-of-type .mw-search-result a"
	);
	const uniqueLinks = new Set<string>();

	searchResults.forEach((element) => {
		const link = element.getAttribute("href");
		if (link) {
			uniqueLinks.add(link);
		}
	});

	const sourcesList: Sources[] = [];
	let totalFiltered = 0;

	console.log(`Durchsuche Ergebnisse (${uniqueLinks.size} insgesamt):`);
	let index = 1;

	for (const link of uniqueLinks) {
		process.stdout.write(`-> Quelle ${index} von ${uniqueLinks.size}\r`);
		index++;

		const rawSources = await findRawSources(getFullUrl(link));
		const [sources, filteredOut] = await filterRawSources(
			rawSources,
			ruleSystem
		);
		sourcesList.push(sources);
		totalFiltered += filteredOut;
	}
	console.log("\r\n");

	return <const>[combineSources(sourcesList), totalFiltered];
}

async function findRawSources(url: string): Promise<RawSources> {
	const select = xpath.useNamespaces({
		html: "http://www.w3.org/1999/xhtml",
	});

	function getLinksFromSection(
		document: Document,
		name: string
	): RawSource[] {
		const ulNodes = select(
			`//html:h3[html:span[@class='mw-headline' and text()='${name}']]/following-sibling::html:ul[1]`,
			document
		) as Node[];

		if (ulNodes && ulNodes.length > 0) {
			const ulElement = ulNodes[0] as Element;
			const liNodes = ulElement.querySelectorAll("li");

			const results = Array.from(liNodes).map((li) => {
				const aElement = li.querySelector("a");
				const textContent = li.textContent?.trim() ?? "";
				const match = textContent.match(/Seite(n)? ([\d-]+)/);
				const pageNumber = match ? match[2] : "";

				return {
					link: aElement
						? getFullUrl(aElement.getAttribute("href")!)
						: "",
					name: aElement ? aElement.textContent?.trim()! : "",
					pages: pageNumber,
				};
			});
			return results;
		}
		return [];
	}

	const response = await axios.get(url);
	const dom = new JSDOM(response.data);
	const document = dom.window.document;

	const sources = {
		main: getLinksFromSection(document, "Ausführliche Quellen"),
		additions: getLinksFromSection(document, "Ergänzende Quellen"),
		references: getLinksFromSection(document, "Erwähnungen"),
	};
	return sources;
}

async function filterRawSources(sources: RawSources, ruleSystem: string) {
	const cleanedSources: Sources = emptySources();
	let filterNum = 0;
	for (const sourceType of <const>["main", "additions", "references"]) {
		for (const source of sources[sourceType]) {
			const ruling = await checkAndUpdateSourceRules(source);
			if (ruling == ruleSystem) {
				let pages: number[] = [];
				if (source.pages.includes("-")) {
					const match = source.pages.match(/(\d+)\-(\d+)/);
					if (match) {
						for (
							let i = parseInt(match[1]);
							i <= parseInt(match[2]);
							i++
						) {
							pages.push(i);
						}
					}
				} else pages.push(parseInt(source.pages));
				cleanedSources[sourceType].push({
					name: source.name,
					pages,
				});
			} else filterNum++;
		}
	}
	return <const>[cleanedSources, filterNum];
}

async function checkAndUpdateSourceRules(
	source: RawSource
): Promise<string | null> {
	const userHome = os.homedir();
	const filePath = path.join(
		userHome,
		"Documents",
		"DSASuche",
		"source_rules.json"
	);

	// Ensure directory exists
	await fs.ensureDir(path.dirname(filePath));

	let data = await fs.readJson(filePath).catch(() => ({}));

	if (data[source.name]) return data[source.name];

	const result = await getSourceRuling(source.link); // Replace with your actual check
	data[source.name] = result;
	await fs.writeJson(filePath, data, { spaces: 2 }).catch(console.error);

	return result;
}

async function getSourceRuling(url: string): Promise<string> {
	const response = await axios.get(url);
	const dom = new JSDOM(response.data);
	const document = dom.window.document;
	const select = xpath.useNamespaces({
		html: "http://www.w3.org/1999/xhtml",
	});
	const nodes = select(
		"//html:table[contains(@class,'infobox')]/html:tbody/html:tr/html:td[html:a[@title='Regelsystem']]/following-sibling::html:td[1]",
		document
	) as Node[];
	return nodes.length ? nodes[0].textContent?.trim() || "" : "";
}

function combineSources(sources: Sources[]) {
	const totalSources: Sources = emptySources();
	const mainNames: Set<string> = new Set();
	const additionsNames: Set<string> = new Set();
	const referencesNames: Set<string> = new Set();

	function combineIn(
		sourceName: SourcesKey,
		set: Set<string>,
		sourceList: Source[]
	) {
		for (const { name, pages } of sourceList) {
			if (set.has(name)) {
				totalSources[sourceName] = totalSources[sourceName].map(
					(source) => {
						if (source.name != name) return source;
						return {
							name,
							pages: Array.from(
								new Set([...source.pages, ...pages])
							),
						};
					}
				);
			} else {
				set.add(name);
				totalSources[sourceName].push({
					name,
					pages,
				});
			}
		}
	}

	for (const { main, additions, references } of sources) {
		combineIn("main", mainNames, main);
		combineIn("additions", additionsNames, additions);
		combineIn("references", referencesNames, references);
	}
	return totalSources;
}

async function nicePrint(phrase: string, ruleSystem: string) {
	const [results, filtered] = await searchWeb(phrase, ruleSystem);
	let text = `===========================================================\n`;
	text += `Ergebnisse für Suche nach "${phrase}:\n\n`;

	function prettySources(sources: Source[]) {
		for (const source of sources) {
			text += ` - ${source.name} (Seite${
				source.pages.length > 1 ? "n" : ""
			}: ${prettyPages(source.pages)})\n`;
		}
		text += "\n";
	}
	function prettyPages(pages: number[]) {
		return pages
			.map((page) => `${page}`)
			.reduce((prev, cur) => `${prev}, ${cur}`);
	}

	if (results.main.length > 0) {
		text += `Ausführliche Quellen:\n`;
		prettySources(results.main);
	}
	if (results.additions.length > 0) {
		text += `Ergänzungen:\n`;
		prettySources(results.additions);
	}
	if (results.references.length > 0) {
		text += `Erwähnungen:\n`;
		prettySources(results.references);
	}

	text += `===========================================================\n`;
	text += `Insgesammt ${filtered} Quellen ignoriert, die nicht dem Regelwerk ${ruleSystem} entsprachen\n`;
	console.log(text);
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function getUserInput(): Promise<string> {
	return new Promise((resolve) => {
		rl.question("Wonach suchst du? ", (input) => {
			resolve(input);
		});
	});
}

async function main() {
	const ruleSystem = process.argv[2] ?? "DSA4.1";

	while (true) {
		const phrase = await getUserInput();
		console.log("\n");
		await nicePrint(phrase, ruleSystem);
		console.log("\n");
	}
}
main().catch((err) => {
	console.error(err);
	rl.close(); // Close readline interface on error
});
