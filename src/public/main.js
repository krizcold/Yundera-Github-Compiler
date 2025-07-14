document.addEventListener('DOMContentLoaded', () => {
    const installButton = document.getElementById('install-button');
    const yamlTextarea = document.getElementById('compose-yaml');
    const statusOutput = document.getElementById('status-output');

    installButton.addEventListener('click', async () => {
        const yamlContent = yamlTextarea.value;

        if (!yamlContent) {
            statusOutput.textContent = 'Error: YAML content cannot be empty.';
            return;
        }

        // The URL is now a simple, same-origin call to our own backend.
        const targetUrl = '/install-via-proxy';
        statusOutput.textContent = `Sending request to our backend at ${targetUrl}...`;

        try {
            // This call is safe from CORS errors.
            const response = await axios.post(
                targetUrl,
                { yaml: yamlContent }, // Send the yaml as a JSON object
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    timeout: 60000, // Increased timeout for backend processing
                }
            );

            statusOutput.textContent = '✅ Success! Response from backend:\n\n';
            statusOutput.textContent += JSON.stringify(response.data, null, 2);

        } catch (error) {
            let errorMessage = '❌ Error!\n\n';
            if (error.response) {
                errorMessage += `Status: ${error.response.status}\n`;
                errorMessage += `Data: ${JSON.stringify(error.response.data, null, 2)}`;
            } else if (error.request) {
                errorMessage += 'No response received from the backend proxy.';
            } else {
                errorMessage += `Error setting up request: ${error.message}`;
            }
            statusOutput.textContent = errorMessage;
        }
    });
});
