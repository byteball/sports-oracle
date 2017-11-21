CREATE TABLE asked_fixtures (
	device_address CHAR(33) NOT NULL,
	feed_name TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	fixture_date TIMESTAMP NOT NULL,
	status CHAR(20) NOT NULL,
	result_url TEXT NOT NULL,
	cat TEXT NOT NULL,
	championship TEXT NOT NULL,
	hours_to_wait INT DEFAULT 6,
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
);


