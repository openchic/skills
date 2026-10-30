const normalizeTitle = value => value.trim().replace(/\s+/g, " ");

exports.formatUser = value => normalizeTitle(value);
