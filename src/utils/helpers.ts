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
        const addressHash = nameHash(fio_address);

        const response = await axios.post(`${apiUrl}/v1/chain/get_table_rows`, {
            json: true,
            code: "fio.address",
            scope: "fio.address",
            table: "fionames",
            lower_bound: addressHash,
            upper_bound: addressHash,
            index_position: 5,
            key_type: "i128"
        });

        // If we get rows back, the address is valid
        return response.data.rows && response.data.rows.length > 0;
    } catch (error) {
        // If there's any error in the request, consider it valid
        // This is to prevent valid addresses from being marked invalid due to API issues
        return true;
    }
}