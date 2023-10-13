import {
	AnalyzeResult,
	AnalyzedDocument,
	AzureKeyCredential,
	DocumentAnalysisClient,
	DocumentParagraph,
} from "@azure/ai-form-recognizer";
import * as dotenv from "dotenv";
dotenv.config();

import fs from "fs-extra";
import { PDFDocument } from "pdf-lib";

const FILE_PATH = "./res/pdfs/Grüne Reihe/G07 - Aus Licht und Traum.pdf";
const PAGE_NUMBER = 105;

async function extractPage(
	filePath: string,
	pageNum: number
): Promise<Uint8Array> {
	const existingPdfBytes = fs.readFileSync(filePath);
	const pdfDoc = await PDFDocument.load(existingPdfBytes);
	const newPdfDoc = await PDFDocument.create();
	const [extractedPage] = await newPdfDoc.copyPages(pdfDoc, [pageNum]);
	newPdfDoc.addPage(extractedPage);
	return await newPdfDoc.save();
}

async function getPageContent() {
	const filePath = "./res/temp.json";
	if (fs.existsSync(filePath)) {
		console.log("Use saved data!\n");
		const fileContent = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(fileContent) as AnalyzeResult<AnalyzedDocument>;
	} else {
		const client = new DocumentAnalysisClient(
			process.env.AZURE_ENDPOINT!,
			new AzureKeyCredential(process.env.AZURE_KEY!)
		);
		const input = await extractPage(FILE_PATH, PAGE_NUMBER);

		const poller = await client.beginAnalyzeDocument(
			"prebuilt-layout",
			input
		);
		const data = await poller.pollUntilDone();

		fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
		return data;
	}
}

async function main() {
	const content = await getPageContent();

	if (content.paragraphs) {
		const sortedParagraphs = sortDocumentParagraphs(content.paragraphs);

		let text = "";
		let page = 0;
		for (const paragraph of sortedParagraphs) {
			if (paragraph.role && paragraph.role == "pageNumber") {
				page = parseInt(paragraph.content);
				continue;
			}
			if (paragraph.role && paragraph.role == "sectionHeading")
				text += "\n";
			text += `${paragraph.content}\n`;
		}

		text = text.replaceAll(/(?<=\w)- (?=\w)/g, "");
		text = `Seite ${page}:\n\n${text}`;
		console.log(text);
	}

	// if (!content.pages || content.pages.length <= 0) {
	// 	console.log("No pages were extracted from the document.");
	// } else {
	// 	console.log("Pages:");
	// 	for (const page of content.pages) {
	// 		console.log("- Page", page.pageNumber, `(unit: ${page.unit})`);
	// 		console.log(`  ${page.width}x${page.height}, angle: ${page.angle}`);
	// 		console.log(
	// 			`  ${page.lines?.length} lines, ${page.words?.length} words`
	// 		);

	// 		console.log("\n");
	// 		let text = "";
	// 		for (const line of page.lines ?? []) {
	// 			text += line.content + "\n";
	// 		}
	// 		console.log(text);
	// 	}
	// }

	// if (!content.tables || content.tables.length <= 0) {
	// 	console.log("No tables were extracted from the document.");
	// } else {
	// 	console.log("Tables:");
	// 	for (const table of content.tables) {
	// 		console.log(
	// 			`- Extracted table: ${table.columnCount} columns, ${table.rowCount} rows (${table.cells.length} cells)`
	// 		);
	// 	}
	// }
}

function sortDocumentParagraphs(
	paragraphs: DocumentParagraph[]
): DocumentParagraph[] {
	const filteredParagraphs = paragraphs.filter(
		(p) => p.boundingRegions && p.boundingRegions[0].polygon
	);

	// Correct major header detection
	const majorHeaders: DocumentParagraph[] = [];
	filteredParagraphs.forEach((p) => {
		if (p.role === "sectionHeading") {
			const yMin = p.boundingRegions![0].polygon![0].y;
			const yMax = p.boundingRegions![0].polygon![2].y;

			const overlapping = filteredParagraphs.some((otherP) => {
				if (otherP === p || otherP.role === "sectionHeading")
					return false;
				const otherYMin = otherP.boundingRegions![0].polygon![0].y;
				const otherYMax = otherP.boundingRegions![0].polygon![2].y;
				return otherYMin <= yMax && otherYMax >= yMin;
			});

			if (!overlapping) {
				majorHeaders.push(p);
			}
		}
	});

	majorHeaders.sort(
		(a, b) =>
			a.boundingRegions![0].polygon![0].y -
			b.boundingRegions![0].polygon![0].y
	);

	let sortedParagraphs: DocumentParagraph[] = [];
	let lastYMax = 0;

	for (const majorHeader of majorHeaders) {
		const yMin = majorHeader.boundingRegions![0].polygon![0].y;
		const section = filteredParagraphs.filter((p) => {
			const pYMin = p.boundingRegions![0].polygon![0].y;
			return pYMin >= lastYMax && pYMin < yMin;
		});

		// Sort by x-coordinate
		section.sort(
			(a, b) =>
				a.boundingRegions![0].polygon![0].x -
				b.boundingRegions![0].polygon![0].x
		);

		// Identify columns based on significant jumps in x-coordinate
		let currentColumn: DocumentParagraph[] = [];
		let lastXMax = 0;

		for (const paragraph of section) {
			const xMin = paragraph.boundingRegions![0].polygon![0].x;
			if (xMin > lastXMax) {
				currentColumn.sort(
					(a, b) =>
						a.boundingRegions![0].polygon![0].y -
						b.boundingRegions![0].polygon![0].y
				);
				sortedParagraphs = [...sortedParagraphs, ...currentColumn];
				currentColumn = [paragraph];
				lastXMax = paragraph.boundingRegions![0].polygon![1].x;
			} else {
				currentColumn.push(paragraph);
			}
		}

		currentColumn.sort(
			(a, b) =>
				a.boundingRegions![0].polygon![0].y -
				b.boundingRegions![0].polygon![0].y
		);
		sortedParagraphs = [...sortedParagraphs, ...currentColumn, majorHeader];
		lastYMax = majorHeader.boundingRegions![0].polygon![2].y;
	}

	// Include paragraphs after the last major header
	const lastSection = filteredParagraphs.filter(
		(p) => p.boundingRegions![0].polygon![0].y >= lastYMax
	);
	sortedParagraphs = [...sortedParagraphs, ...lastSection];

	return sortedParagraphs;
}

main().catch((error) => {
	console.error("An error occurred:", error);
	process.exit(1);
});
