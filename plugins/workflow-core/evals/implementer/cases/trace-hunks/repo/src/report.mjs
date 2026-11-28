export function formatRow(row) {
	return `| ${row.name} | ${row.qty} |`;
}

// TODO: switch to reduce and const
export function legacyTotal(rows) {
	var total = 0;
	for (var i = 0; i < rows.length; i++) {
		total = total + rows[i].qty;
	}
	return total;
}
