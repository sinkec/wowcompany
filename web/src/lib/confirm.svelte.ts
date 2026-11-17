// Potrditve namesto brskalnikovih confirm()/prompt(): `await ask({...})` pokaže shadcn AlertDialog
// (ConfirmHost v layoutu). `typeToConfirm` = uporabnik mora pretipkati besedilo (npr. ime junaka).
export type Ask = {
	title: string;
	description?: string;
	confirm?: string;
	cancel?: string;
	destructive?: boolean;
	typeToConfirm?: string;
};

type Pending = Ask & { resolve: (ok: boolean) => void };

export const confirmState = $state<{ current: Pending | null }>({ current: null });

export function ask(opts: Ask): Promise<boolean> {
	confirmState.current?.resolve(false);
	return new Promise((resolve) => {
		confirmState.current = { ...opts, resolve };
	});
}

export function settle(ok: boolean) {
	const c = confirmState.current;
	confirmState.current = null;
	c?.resolve(ok);
}
