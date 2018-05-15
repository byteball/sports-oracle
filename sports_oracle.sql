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


-- execute the SQL commands below to update structure for May 2018 code refactoring 
/*
BEGIN;

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

INSERT OR IGNORE INTO requested_fixtures (feed_name,fixture_date,result_url,hours_to_wait,creation_date) SELECT feed_name,fixture_date,result_url,hours_to_wait,creation_date FROM asked_fixtures;
INSERT OR IGNORE INTO devices_having_requested_fixture (feed_name,device_address) SELECT feed_name,device_address FROM asked_fixtures;

DROP TABLE asked_fixtures;


COMMIT;
*/


