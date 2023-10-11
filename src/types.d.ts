interface RawSource {
	link: string;
	name: string;
	pages: string;
}

interface RawSources {
	main: RawSource[];
	additions: RawSource[];
	references: RawSource[];
}

interface Source {
	name: string;
	pages: number[];
}

interface Sources {
	main: Source[];
	additions: Source[];
	references: Source[];
}

type SourcesKey = keyof Sources;
