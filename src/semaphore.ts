export class Semaphore {
	private count: number;
	private waiters: (() => void)[] = [];

	constructor(private capacity: number) {
		this.count = capacity;
	}

	async acquire() {
		if (this.count > 0) {
			this.count--;
			return;
		}

		await new Promise<void>((resolve) => {
			this.waiters.push(resolve);
		});
	}

	release() {
		this.count++;
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter();
		}
	}
}
