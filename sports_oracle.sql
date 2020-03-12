CREATE TABLE requested_fixtures (
	feed_name TEXT NOT NULL PRIMARY KEY,
	fixture_date TIMESTAMP NOT NULL,
	result_url TEXT NOT NULL,
	hours_to_wait INT DEFAULT 6,
	has_critical_error TINYINT DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE devices_having_requested_fixture (
	device_address CHAR(33) NOT NULL,
	feed_name TEXT NOT NULL,
	UNIQUE(device_address, feed_name),
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
);


CREATE TABLE aas_having_requested_fixture (
	aa_address CHAR(32) NOT NULL,
	device_address CHAR(33) NOT NULL,
	feed_name TEXT NOT NULL,
	UNIQUE(aa_address, feed_name, device_address)
);

CREATE TABLE triggered_aas (
	aa_address CHAR(32) NOT NULL,
	feed_name TEXT NOT NULL,
	UNIQUE(aa_address, feed_name)
);

