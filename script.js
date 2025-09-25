(function() {
    var keys = null;
    var keysLoaded = false;
    var amiiboDatabase = null;
    var amiiboZip = null;
    var g_data = null;

    // Load keys from localStorage if available
    function loadStoredKeys() {
        try {
            const storedKeys = localStorage.getItem('maboiiKeys');
            if (storedKeys) {
                const keyData = JSON.parse(storedKeys);
                keys = keyData;
                keysLoaded = true;
                updateKeyStatus();
                console.log('Keys loaded from localStorage');
            }
        } catch (error) {
            console.error('Error loading stored keys:', error);
            localStorage.removeItem('maboiiKeys');
        }
    }

    // Save keys to localStorage
    function saveKeysToStorage(keyData) {
        try {
            localStorage.setItem('maboiiKeys', JSON.stringify(keyData));
            console.log('Keys saved to localStorage');
        } catch (error) {
            console.error('Error saving keys to localStorage:', error);
        }
    }

    // Update key status UI
    function updateKeyStatus() {
        const statusEl = document.getElementById('keyStatus');
        const clearBtn = document.getElementById('clearKeysBtn');

        if (keysLoaded && keys) {
            statusEl.className = 'badge badge-success';
            statusEl.textContent = 'Keys loaded - ready to generate amiibo files ✓';
            clearBtn.style.display = 'inline-block';
            // Generate zip when keys are loaded via file upload (if amiibo data is available)
            if (amiiboDatabase) {
                generateZip();
            }
        } else {
            statusEl.className = 'badge badge-warning';
            statusEl.textContent = 'Upload retail keys to generate amiibo files';
            clearBtn.style.display = 'none';
            // Hide zip download section when no keys
            $(".hide_until_zipped").addClass("hide_until_zipped");
        }
    }

    // Load keys from file
    function loadKeysFromFile() {
        const fileInput = document.getElementById('keyFileInput');
        const file = fileInput.files[0];

        if (!file) {
            showNotification('Please select a key file first', 'warning');
            return;
        }

        if (file.name !== 'key_retail.bin' && !file.name.includes('key')) {
            if (!confirm('File name doesn\'t match expected key file format. Continue anyway?')) {
                return;
            }
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const keyBuffer = e.target.result;
                const keyArray = Array.from(new Uint8Array(keyBuffer));

                // Load keys with maboii
                keys = maboii.loadMasterKeys(keyArray);

                if (!keys) {
                    throw new Error('Invalid key file format');
                }

                keysLoaded = true;
                saveKeysToStorage(keys);
                updateKeyStatus();

                showNotification('Keys loaded successfully! You can now generate encrypted amiibo files.', 'success');

            } catch (error) {
                console.error('Error loading keys:', error);
                showNotification('Error loading keys: ' + error.message, 'error');
            }
        };

        reader.onerror = function() {
            showNotification('Error reading file', 'error');
        };

        reader.readAsArrayBuffer(file);
    }

    // Clear stored keys
    function clearKeys() {
        keys = null;
        keysLoaded = false;
        localStorage.removeItem('maboiiKeys');
        updateKeyStatus();
        document.getElementById('keyFileInput').value = '';
        showNotification('Keys cleared successfully.', 'info');
    }

    // Generate random UID
    function generateRandomUID() {
        const uid = new Array(7);
        uid[0] = 0x04; // Standard NFC Type A UID prefix

        // Generate 6 random bytes
        const randomBytes = new Uint8Array(6);
        crypto.getRandomValues(randomBytes);
        for (let i = 1; i < 7; i++) {
            uid[i] = randomBytes[i-1];
        }

        return uid;
    }

    // Calculate BCC0 for the UID
    function calculateBCC0(uid) {
        return uid[0] ^ uid[1] ^ uid[2] ^ 0x88;
    }

    // Calculate PWD using the correct method (skip BCC0)
    function calculatePWD(packedUID) {
        const uid7 = new Array(7);
        uid7[0] = packedUID[0];
        uid7[1] = packedUID[1];
        uid7[2] = packedUID[2];
        uid7[3] = packedUID[4]; // Skip BCC0 at position 3
        uid7[4] = packedUID[5];
        uid7[5] = packedUID[6];
        uid7[6] = packedUID[7];

        return [
            (0xAA ^ uid7[1] ^ uid7[3]) & 0xFF,
            (0x55 ^ uid7[2] ^ uid7[4]) & 0xFF,
            (0xAA ^ uid7[3] ^ uid7[5]) & 0xFF,
            (0x55 ^ uid7[4] ^ uid7[6]) & 0xFF
        ];
    }

    // Generate encrypted amiibo data using our fixed maboii.js logic
    async function generateEncryptedData(amiiboId) {
        try {
            // Create base unpacked data (540 bytes of zeros)
            const unpackedData = new Array(540).fill(0);

            // Generate random UID
            const randomUID = generateRandomUID();
            const bcc0 = calculateBCC0(randomUID);

            console.log(`Generating encrypted amiibo: ${amiiboId}`);
            console.log(`UID: ${randomUID.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

            // Set UID in unpacked data (positions 468-475)
            unpackedData[468] = randomUID[0];
            unpackedData[469] = randomUID[1];
            unpackedData[470] = randomUID[2];
            unpackedData[471] = bcc0;
            unpackedData[472] = randomUID[3];
            unpackedData[473] = randomUID[4];
            unpackedData[474] = randomUID[5];
            unpackedData[475] = randomUID[6];

            // Set the magic bytes from AmiiboConverter
            const magicBytes1 = [0x48, 0x0f, 0xe0, 0xf1, 0x10, 0xff, 0xee, 0xa5];
            for (let i = 0; i < magicBytes1.length; i++) {
                unpackedData[9 + i] = magicBytes1[i];
            }

            // Set more magic bytes at position 520
            const magicBytes2 = [0x01, 0x00, 0x0f, 0xbf, 0x00, 0x00, 0x00, 0x04,
                                0x5f, 0x00, 0x00, 0x00, 0x4e, 0xdb, 0xf1, 0x28,
                                0x80, 0x80, 0x00, 0x00];
            for (let i = 0; i < magicBytes2.length; i++) {
                unpackedData[520 + i] = magicBytes2[i];
            }

            // Set amiibo ID in UNPACKED data at position 476-483 BEFORE packing
            const idBytes = [];
            for (let i = 0; i < amiiboId.length; i += 2) {
                idBytes.push(parseInt(amiiboId.substr(i, 2), 16));
            }
            for (let i = 0; i < 8; i++) {
                unpackedData[476 + i] = idBytes[i];
            }

            // Pack the data
            let packedData = await maboii.pack(keys, unpackedData);

            // Set magic bytes in PACKED data (they get lost during packing)
            const packedMagicBytes = [0x48, 0x0f, 0xe0, 0xf1, 0x10, 0xff, 0xee, 0xa5];
            for (let i = 0; i < packedMagicBytes.length; i++) {
                packedData[9 + i] = packedMagicBytes[i];
            }

            // Fix position 8 (XOR of bytes 4-7)
            packedData[8] = packedData[4] ^ packedData[5] ^ packedData[6] ^ packedData[7];

            // Calculate and set PWD
            const pwd = calculatePWD(packedData);
            packedData[532] = pwd[0];
            packedData[533] = pwd[1];
            packedData[534] = pwd[2];
            packedData[535] = pwd[3];

            // Set PACK
            packedData[536] = 0x80;
            packedData[537] = 0x80;

            console.log(`✅ Encrypted amiibo generated successfully`);
            return new Uint8Array(packedData);

        } catch (error) {
            console.error('Error generating encrypted amiibo:', error);
            throw error;
        }
    }

    // Original decrypted data generation (fallback)
    function generateDecryptedData(id) {
        var arr = new Uint8Array(540);
        arr[2] = 0x0F;
        arr[3] = 0xE0;
        // write key/amiibo num in big endian as a 64 bit value starting from offset off
        var off = 0x1DC;
        id = id.substring(2);

        for(var i = 0; i < 16; i += 2, off += 1) {
            arr[off] = parseInt(id.substring(i, i + 2), 16);
        }

        return arr;
    }

    function populateTable() {
        $.getJSON("https://raw.githubusercontent.com/N3evin/AmiiboAPI/master/database/amiibo.json", function(data) {
            amiiboDatabase = data;
            g_data = data;
            var t = $('#dataTable').DataTable();
            Object.keys(data.amiibos).forEach(function(key) {
                var ami = data.amiibos[key];
                var name = ami.name;
                var keytext = key.padStart(16, '0');
                var keylink = key.substring(2).padStart(16, '0');

                var link = "https://raw.githubusercontent.com/N3evin/AmiiboAPI/master/images/icon_" + keylink.substr(0, 8) + "-" + keylink.substr(8, 8) + ".png"
                var image = `<div class="amiibo-image"><img src="${link}" /></div>`;
                t.row.add([image, `<span class="table-text">${name}</span>`, `<span class="table-text">${keytext}</span>`]);
            });
            t.draw(false);
            // Generate zip if keys were loaded from localStorage
            if (keysLoaded && keys) {
                generateZip();
            }
        });
    };

    async function downloadBin(name, id) {
        // Require keys to be loaded
        if (!keysLoaded || !keys) {
            showNotification('Please upload your retail key file first to generate amiibo files.', 'warning');
            return;
        }

        try {
            // Generate encrypted amiibo (only option now)
            const data = await generateEncryptedData(id.substring(2));
            const file = name + " (" + id.substr(4, 12) + ").bin";
            console.log(file);
            download("data:application/octet-stream;base64," + base64.fromBytes(data), file, "application/octet-stream");

        } catch (error) {
            console.error('Error generating amiibo:', error);
            showNotification('Error generating amiibo: ' + error.message, 'error');
        }
    };

    async function generateZip() {
        // Require keys to be loaded
        if (!keysLoaded || !keys) {
            showNotification('Please upload your retail key file first to generate the zip file.', 'warning');
            return;
        }

        const specialCharacters = ["<", ">", ":", "\"", "/", "\\", "|", "?", "*"];
        var zip = new JSZip();

        const keys_local = Object.keys(amiiboDatabase.amiibos);
        let processed = 0;
        const total = keys_local.length;

        // Show progress
        console.log(`Generating zip with ${total} amiibos...`);

        for (const key of keys_local) {
            try {
                var ami = amiiboDatabase.amiibos[key];
                ami.series = amiiboDatabase.amiibo_series["0x"+key.substr(14, 2)];

                // Generate encrypted amiibo (only option now)
                const data = await generateEncryptedData(key.substring(2));
                var file = ami.name + " (" + key.substr(4, 12) + ").bin";

                specialCharacters.forEach(function(char) {
                    file = file.replace(char, "_");
                });

                var folder = zip.folder(ami.series);
                folder.file(file, data);

                processed++;
                if (processed % 50 === 0) {
                    console.log(`Processed ${processed}/${total} amiibos...`);
                }

            } catch (error) {
                console.error(`Error processing ${key}:`, error);
                // Continue with next amiibo
            }
        }

        console.log('Finalizing zip...');
        zip.generateAsync({type:"blob"}).then(function(content) {
            amiiboZip = content;
            $(".hide_until_zipped").removeClass("hide_until_zipped");
            $("a#downloadZip").click(function(e) {
                e.preventDefault();
                download(amiiboZip, 'amiibo.zip', 'application/octet-stream');
            });
            console.log('Zip generation complete!');
        });
    };

    // Run on page load
    $(function() {
        // Load stored keys first
        loadStoredKeys();
        updateKeyStatus();

        // Set up event handlers
        document.getElementById('loadKeysBtn').addEventListener('click', loadKeysFromFile);
        document.getElementById('clearKeysBtn').addEventListener('click', clearKeys);

        populateTable();
        oTable = $('#dataTable').DataTable({
            "lengthMenu": [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
        });

        $('#dataTable tbody').on('click', 'tr', function() {
            var data = oTable.row( this ).data();
            downloadBin($(data[1]).text(), $(data[2]).text());
        });

        $('#input').keyup(function() {
            oTable.search(jQuery.fn.DataTable.ext.type.search.string($(this).val())).draw();
        });
    });
})();