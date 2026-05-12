import { lib } from '@aa900031/tsdown-config'

export default lib({
	entry: {
		index: 'src/index.ts',
		helper: 'src/helper.ts',
	},
}, {
	format: ['esm', 'cjs'],
})
