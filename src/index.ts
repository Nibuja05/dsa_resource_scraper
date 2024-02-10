import readline from "readline";
import OpenAI from "openai";

import * as dotenv from "dotenv";
import { searchWeb } from "./search";
import { getAnalyzed } from "./analyze";
import { estimateTokenCount, splitStringWithSeparator } from "./util";
import { createSearchIndex, search } from "./docSearch";
dotenv.config();

const openai = new OpenAI({
	apiKey: process.env.OPENAI_KEY, // This is the default and can be omitted
});
const keyWordInstruction = `User
Follow my instructions precisely to create a highly effective Query Logic Composition from the following input query. Do not explain or elaborate. Identify the most relevant key components of the input query (ignore stop words, etc). Please return only the base of the word (no conjugation/plural etc,) and substantize and adjust it as needed. Return them in a quoted list, as following:
["ItemA", "ItemB", ...]

Example: Wie lange kann man unterwasser atmen? -> ["Atmen", "Unterwasser"]
Example: Wie viel kostet eine Zwiebel? -> ["Kosten", "Zwiebel"]`;
const finalInstruction = `You are an expert for the Roleplaying Game DSA (Das Schwarze Auge). Your task is to answer a given query as precisely as possible. Use the given sources as input and only answer with statements that can be proven by the input. Cite the source like this: ...Text... [Quelle: <Quelle>].`;

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
		// model: "gpt-3.5-turbo",
		model: "gpt-4",
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
			if (!match) {
				console.log("COULD NOT MATCH");
				continue;
			}
			const doc: DSADocument = {
				id,
				title: match[1] ?? "",
				content: match[2] ?? "",
				source: name,
				sourcePage: page,
				orig: part,
			};
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
	return;
	// const phrase = "Was ist Endurium?";
	// const answer = ["Endurium"];

	console.log("Suche...");

	// let analyzedPages: AnalyzeResults[] = [];
	let documents: DSADocument[] = [];

	for (const keyword of answer) {
		console.log(`-> nach ${keyword}`);
		const [results, filtered] = await searchWeb(keyword, "DSA4.1");

		for (const { name, pages } of results.main) {
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

	const docIndex = createSearchIndex(documents);
	const result = search(phrase, docIndex);

	const docInputs: string[] = [];

	for (let i = 0; i < 5; i++) {
		const bestResult = result[i].ref;
		const bestDoc = documents[parseInt(bestResult)];
		const newInput = `${bestDoc.source}: ${bestDoc.sourcePage}\n${bestDoc.orig}`;
		docInputs.push(newInput);
	}

	console.log(docInputs);
	return;

	const finalAnswer = await askGPT(finalInstruction, phrase, docInputs);

	console.log(finalAnswer);
}
main().catch((err) => {
	console.error(err);
	rl.close(); // Close readline interface on error
});
