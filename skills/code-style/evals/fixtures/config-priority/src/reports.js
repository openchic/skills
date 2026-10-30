const normalizeTitle = value => value.trim().replace(/\s+/g, " ");

exports.formatReport = value => normalizeTitle(value);
