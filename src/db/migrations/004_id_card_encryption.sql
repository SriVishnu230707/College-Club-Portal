ALTER TABLE club_join_requests ADD COLUMN id_card_iv BLOB;
ALTER TABLE club_join_requests ADD COLUMN id_card_tag BLOB;

CREATE TABLE id_card_crypto_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  key_check BLOB NOT NULL
);
