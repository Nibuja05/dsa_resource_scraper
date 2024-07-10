import readline from "readline";
import OpenAI from "openai";

import fs from "fs-extra";

import * as dotenv from "dotenv";
import { searchWeb } from "./search";
import { getAnalyzed } from "./analyze";
import { estimateTokenCount, splitStringWithSeparator } from "./util";
import { createSearchIndex, search, vectorSearch } from "./docSearch";
import openaiTokenCounter from "openai-gpt-token-counter";
dotenv.config();

const openai = new OpenAI({
	apiKey: process.env.OPENAI_KEY, // This is the default and can be omitted
});
const keyWordInstruction = `User
Follow my instructions precisely to create a highly effective Query Logic Composition from the following input query. Do not explain or elaborate. Identify the most relevant key components of the input query (ignore stop words, etc). Please return only the base of the word (no conjugation/plural etc,) and substantize and adjust it as needed. Return them in a quoted list, as following:
["ItemA", "ItemB", ...]
Don't split compound words, Example: "Was ist ein Riesenkäfer?" -> ["Riesenkäfer"]
Only use the most relevant words, where specific knowledge is required, Example: "Welche Sorten Wein sind bekannt?" -> ["Wein"] // don't include Sorte or bekannt, as this is common knowledge

Example: "Wie lange kann man unterwasser atmen?" -> ["Atmen", "Unterwasser"]
Example: "Wie viel kostet eine Zwiebel?" -> ["Kosten", "Zwiebel"]`;
const finalInstruction = `You are an expert for the Roleplaying Game DSA (Das Schwarze Auge). Your task is to answer a given query as precisely as possible. Use the given sources as input and only answer with statements that can be proven by the input. Cite the source like this: ...Text... [Quelle: <Quelle>].`;
const OPENAI_MODEL = "gpt-3.5-turbo";

async function askGPT(
	instruction: string,
	phrase: string,
	additionalInput?: string[],
	asList?: false
): Promise<string>;
async function askGPT(
	instruction: string,
	phrase: string,
	additionalInput?: string[],
	asList?: true
): Promise<Array<string>>;
async function askGPT(
	instruction: string,
	phrase: string,
	additionalInput?: string[],
	asList?: boolean
): Promise<string | Array<string>> {
	const systemMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
		(additionalInput ?? []).map((doc) => ({
			role: "system",
			content: doc,
		}));

	const chatCompletion = await openai.chat.completions.create({
		messages: [
			...systemMessages,
			{ role: "user", content: `${instruction}\n\nInput: ${phrase}` },
		],
		model: OPENAI_MODEL,
		// model: "gpt-4",
	});
	const choices = chatCompletion.choices.map(
		(choice) => choice.message.content
	);
	const bestChoice = choices[0]!;
	if (asList) return eval(bestChoice) as Array<string>;
	return bestChoice;
}

function createDocuments(
	pages: AnalyzeResults[],
	name?: string
): DSADocument[] {
	let docs: DSADocument[] = [];
	let id = 0;
	for (const [content, page] of pages) {
		const parts = splitStringWithSeparator(content, "##");
		for (const part of parts) {
			const match = part.match(/##\s*(.*?)\n\s*(.*)/s);
			const doc: DSADocument = {
				id,
				title: "",
				content: part,
				source: name,
				sourcePage: page,
				orig: part,
			};
			if (match) {
				doc.title = match[1] ?? "";
				doc.content = match[2] ?? "";
			}
			id++;
			docs.push(doc);
		}
	}
	return docs;
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function getUserInput(question = "Was möchtest du wissen?"): Promise<string> {
	return new Promise((resolve) => {
		rl.question(`${question} `, (input) => {
			resolve(input);
		});
	});
}

async function main() {
	const phrase = await getUserInput();
	rl.close();
	console.log("\n");
	const answer = await askGPT(keyWordInstruction, phrase, undefined, true);

	console.log(answer);
	// const phrase = "Was ist Endurium?";
	// const answer = ["Endurium"];

	console.log("Suche...");

	// let analyzedPages: AnalyzeResults[] = [];
	let documents: DSADocument[] = [];

	for (const keyword of answer) {
		console.log(`-> nach ${keyword}`);
		const [results, filtered] = await searchWeb(keyword, "DSA4.1");

		for (const { name, pages } of results.main) {
			console.log(`\nAnaylyze: "${name}" (${pages})`);
			const analyzeResult = await getAnalyzed(name, pages).catch((err) =>
				console.log("An error occured: ", err)
			);
			if (analyzeResult)
				documents = [
					...documents,
					...createDocuments(analyzeResult, name),
				];
			// analyzedPages = [...analyzedPages, ...analyzeResult];
		}
	}

	// const docIndex = createSearchIndex(documents);
	// const result = search(phrase, docIndex);

	console.log("\nSearching in results for query answers...\n");
	let vectorResults = await vectorSearch(phrase, documents);

	const docInputs: string[] = [];

	// calculate tokens
	const maxTokens = 8192;
	let curTokens = 0;

	for (let i = 0; i < 10; i++) {
		const result = vectorResults[i];
		if (!result) continue;

		const newInput = `${result.document.source}: ${result.document.sourcePage}\n${result.document.content}`;

		const tokenCount = estimateTokenCount(newInput);
		if (curTokens + tokenCount >= maxTokens) break; // dont use too many ressources!
		curTokens += tokenCount;
		docInputs.push(newInput);
	}

	// for (let i = 0; i < 10; i++) {
	// 	if (!result[i]) continue;
	// 	const bestResult = result[i].ref;
	// 	const bestDoc = documents[parseInt(bestResult)];
	// 	const newInput = `${bestDoc.source}: ${bestDoc.sourcePage}\n${bestDoc.orig}`;

	// 	const tokenCount = estimateTokenCount(newInput);
	// 	if (curTokens + tokenCount >= maxTokens) break; // dont use too many ressources!
	// 	curTokens += tokenCount;
	// 	docInputs.push(newInput);
	// }

	// let docs = [];
	// for (const doc of documents) {
	// 	docs.push(`${doc.source} - ${doc.sourcePage}: ${doc.orig}`);
	// }

	fs.writeFileSync(
		"./out_docs_test.json",
		JSON.stringify(docInputs, null, 2)
	);

	// fs.writeFileSync("./out_docs_all_test.json", JSON.stringify(docs, null, 2));

	if (docInputs.length == 0) {
		console.log(
			"\n\nThere was no input document found! No sources means no answer :/"
		);
		return;
	}

	console.log("\nAsking AI for final answer...\n");
	const finalAnswer = await askGPT(finalInstruction, phrase, docInputs);

	console.log(finalAnswer);
}
main().catch((err) => {
	console.error(err);
	rl.close(); // Close readline interface on error
});
