// Helper functions
import { config } from '../config/env';
import axios from 'axios';
import crypto from 'crypto';

// Function to get the full base URL
export const getFullBaseUrl = () => {
    let baseUrl = config.baseUrl || 'http://localhost';
    const url = new URL(baseUrl);

    if (config.external_port !== null &&
        ((url.protocol === 'http:' && config.external_port !== 80) ||
            (url.protocol === 'https:' && config.external_port !== 443))) {
        url.port = config.external_port.toString();
    }

    return url.toString().replace(/\/$/, '');
};

// Format url
export function formatUrl(url: string): string {
    url = url.replace(/\/$/, '');
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        return `https://${url}`;
    }
    return url;
}

// Join url with path from chain.json or bp.json
export function urlJoin(...parts: string[]): string {
    return parts
        .map(part => part.trim().replace(/^\/|\/$/g, ''))
        .filter(part => part.length)
        .join('/');
}

// Convert total_votes to Int
export function processTotalVotes(votesString: string): number {
    // Remove decimal places and divide by 1,000,000,000
    const votesWithoutDecimal = votesString.split('.')[0];
    const votesNumber = parseInt(votesWithoutDecimal, 10);
    return Math.floor(votesNumber / 1000000000);
}

// Generate SHA-1 hash for FIO Handle
function nameHash(name: string): string {
    const hash = crypto.createHash('sha1');
    return '0x' + hash.update(name).digest().slice(0, 16).reverse().toString('hex');
}

// Checks if FIO Handle is valid
export async function isFioAddressValid(fio_address: string, apiUrl: string): Promise<boolean> {
    if (!fio_address) return false;

    try {
        // Step 1: Check if FIO Handle exists
        const addressHash = nameHash(fio_address);

        const addressResponse = await axios.post(`${apiUrl}/v1/chain/get_table_rows`, {
            json: true,
            code: "fio.address",
            scope: "fio.address",
            table: "fionames",
            lower_bound: addressHash,
            upper_bound: addressHash,
            index_position: 5,
            key_type: "i128"
        });

        // If FIO Handle doesn't exist, return false
        if (!addressResponse.data.rows || addressResponse.data.rows.length === 0) {
            return false;
        }

        // Step 2: Extract domain part (after @)
        const domainParts = fio_address.split('@');
        if (domainParts.length !== 2) {
            return false; // Invalid FIO Handle format
        }
        const domain = domainParts[1];

        // Step 3: Hash the domain
        const domainHash = nameHash(domain);

        // Step 4: Check if domain exists and is not expired
        const domainResponse = await axios.post(`${apiUrl}/v1/chain/get_table_rows`, {
            json: true,
            code: "fio.address",
            scope: "fio.address",
            table: "domains",
            lower_bound: domainHash,
            upper_bound: domainHash,
            index_position: 4,
            key_type: "i128"
        });

        // If domain doesn't exist, return false
        if (!domainResponse.data.rows || domainResponse.data.rows.length === 0) {
            return false;
        }

        // Step 5: Check if domain is not expired
        const domainData = domainResponse.data.rows[0].data;
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        return domainData.expiration > now;
    } catch (error) {
        // If there's any error in the request, consider it valid
        // This is to prevent valid addresses from being marked invalid due to API issues
        return true;
    }
}