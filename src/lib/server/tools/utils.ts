import { env } from "$env/dynamic/private";
import { Client } from "@gradio/client";
import { SignJWT } from "jose";
import { logger } from "../logger";
import JSON5 from "json5";

export type GradioImage = {
	path: string;
	url: string;
	orig_name: string;
	is_stream: boolean;
	meta: Record<string, unknown>;
};

type GradioResponse = {
	data: unknown[];
};

export async function callSpace<TInput extends unknown[], TOutput extends unknown[]>(
	name: string,
	func: string,
	parameters: TInput,
	ipToken: string | undefined
): Promise<TOutput> {
	class CustomClient extends Client {
		fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
			init = init || {};
			init.headers = {
				...(init.headers || {}),
				...(ipToken ? { "X-IP-Token": ipToken } : {}),
			};
			return super.fetch(input, init);
		}
	}
	const client = await CustomClient.connect(name, {
		hf_token: (env.HF_TOKEN ?? env.HF_ACCESS_TOKEN) as unknown as `hf_${string}`,
	});

	return await client
		.predict(func, parameters)
		.then((res) => (res as unknown as GradioResponse).data as TOutput)
		.catch((e) => {
			logger.error(e);
			throw e;
		});
}

export async function getIpToken(ip: string, username?: string) {
	const ipTokenSecret = env.IP_TOKEN_SECRET;
	if (!ipTokenSecret) {
		return;
	}
	return await new SignJWT({ ip, user: username })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime("1m")
		.sign(new TextEncoder().encode(ipTokenSecret));
}

export { toolHasName } from "$lib/utils/tools";

export async function extractJson(text: string): Promise<unknown[]> {
	const calls: string[] = [];

	let codeBlocks = Array.from(text.matchAll(/```json\n(.*?)```/gs))
		.map(([, block]) => block)
		// remove trailing comma
		.map((block) => block.trim().replace(/,$/, ""));

	// if there is no code block, try to find the first json object
	// by trimming the string and trying to parse with JSON5
	if (codeBlocks.length === 0) {
		const start = [text.indexOf("["), text.indexOf("{")]
			.filter((i) => i !== -1)
			.reduce((a, b) => Math.max(a, b), -Infinity);
		const end = [text.lastIndexOf("]"), text.lastIndexOf("}")]
			.filter((i) => i !== -1)
			.reduce((a, b) => Math.min(a, b), Infinity);

		if (start === -Infinity || end === Infinity) {
			return [""];
		}

		const json = text.substring(start, end + 1);
		codeBlocks = [json];
	}

	// grab only the capture group from the regex match
	for (const block of codeBlocks) {
		// make it an array if it's not already
		let call = JSON5.parse(block);
		if (!Array.isArray(call)) {
			call = [call];
		}
		calls.push(call);
	}
	return calls.flat();
}
