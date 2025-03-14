import { prisma } from '../config/database';
import { config } from '../config/env';
import { isFioAddressValid } from "../utils/helpers";
import { logger_log, logger_error } from '../utils/logger';
import axios from 'axios';

interface VoterData {
    id: number;
    fioaddress: string;
    addresshash: string;
    owner: string;
    proxy: string;
    producers: string[];
    last_vote_weight: string;
    proxied_vote_weight: string;
    is_proxy: number;
    is_auto_proxy: number;
    reserved2: number;
    reserved3: string;
}

interface VoterWeight {
    owner: string;
    weight: number;
}

// Main function to fetch and process voters data
export async function fetchVoters() {
    try {
        const chains = ['Mainnet', 'Testnet'];

        for (const chain of chains) {
            const apiUrl = await getBestApiNode(chain.toLowerCase() as 'mainnet' | 'testnet');

            if (!apiUrl) {
                logger_error('VOTERS', `No suitable API node found for ${chain}`, new Error('No API node available'));
                continue;
            }

            logger_log('VOTERS', `Fetching voters for ${chain} from ${apiUrl}`);

            // Get all voters from API
            let allVoters: VoterData[] = [];
            let hasMore = true;
            let lowerBound = 0;

            while (hasMore) {
                try {
                    const response = await axios.post(`${apiUrl}/v1/chain/get_table_rows`, {
                        json: true,
                        code: "eosio",
                        scope: "eosio",
                        table: "voters",
                        limit: "2500",
                        lower_bound: lowerBound.toString(),
                        reverse: false
                    });

                    const votersData = response.data;
                    allVoters = [...allVoters, ...votersData.rows];

                    hasMore = votersData.more;
                    if (hasMore && votersData.rows.length > 0) {
                        lowerBound = votersData.rows[votersData.rows.length - 1].id + 1;
                    } else {
                        hasMore = false;
                    }

                    logger_log('VOTERS', `Fetched ${votersData.rows.length} voters. Total: ${allVoters.length}. More: ${hasMore}`);
                } catch (error) {
                    logger_error('VOTERS', `Error fetching voters from ${apiUrl}:`, error);
                    hasMore = false;
                }
            }

            logger_log('VOTERS', `Received ${allVoters.length} voters for ${chain}. Processing...`);

            await processVoters(allVoters, chain);
        }
    } catch (error) {
        logger_error('VOTERS', 'Catch all error in fetchVoters() ', error);
    }
    logger_log('VOTERS', 'Done updating voters.');
}

// Get best API node for fetching voters data
async function getBestApiNode(chain: 'mainnet' | 'testnet'): Promise<string | null> {
    try {
        const nodes = await prisma.producerNodes.findMany({
            where: {
                chain: chain === 'mainnet' ? 'Mainnet' : 'Testnet',
                api: true,
                status: 'active'
            },
            include: {
                apiFetchChecks: {
                    orderBy: {
                        time_stamp: 'desc'
                    },
                    take: 1
                },
                apiBurstChecks: {
                    orderBy: {
                        time_stamp: 'desc'
                    },
                    take: 1
                }
            },
            orderBy: [
                {
                    apiFetchChecks: {
                        _count: 'desc'
                    }
                },
                {
                    id: 'asc'
                }
            ]
        });

        // Filter nodes that support burst and have fetch checks
        const suitableNodes = nodes.filter(node =>
            node.apiBurstChecks.length > 0 &&
            node.apiBurstChecks[0].status &&
            node.apiFetchChecks.length > 0
        );

        if (suitableNodes.length === 0) {
            return null;
        }

        // Sort by highest results
        suitableNodes.sort((a, b) =>
            (b.apiFetchChecks[0]?.results || 0) - (a.apiFetchChecks[0]?.results || 0)
        );

        return suitableNodes[0].url;
    } catch (error) {
        logger_error('VOTERS', 'Error getting best API node:', error);
        return null;
    }
}

// Process voters data and update database
async function processVoters(voters: VoterData[], chain: string) {
    try {
        // Clear existing data for this chain
        await prisma.producerVotes.deleteMany({
            where: {
                producer: {
                    chain
                }
            }
        });

        await prisma.proxies.deleteMany({
            where: { chain }
        });

        logger_log('VOTERS', `Cleared existing voters data for ${chain}`);

        // Group voters by producer
        const producerVoters: Map<string, VoterWeight[]> = new Map();
        // Group delegators by proxy
        const proxyDelegators: Map<string, VoterWeight[]> = new Map();

        // First pass: collect all proxy delegations
        for (const voter of voters) {
            const voterWeight = parseFloat(voter.last_vote_weight)/1000000000;

            // If this voter is proxying to someone else
            if (voter.proxy && voter.proxy.trim() !== '') {
                // Add voter to proxy's delegators
                const delegator: VoterWeight = {
                    owner: voter.owner,
                    weight: voterWeight
                };

                if (!proxyDelegators.has(voter.proxy)) {
                    proxyDelegators.set(voter.proxy, []);
                }
                proxyDelegators.get(voter.proxy)!.push(delegator);
            }
        }

        // Second pass: collect direct producer votes and save proxies
        for (const voter of voters) {
            const voterWeight = parseFloat(voter.last_vote_weight)/1000000000;

            // If voter is voting directly for producers (not proxying)
            if ((!voter.proxy || voter.proxy.trim() === '') && voter.producers.length > 0) {
                // Add voter to each producer's voters
                const voterEntry: VoterWeight = {
                    owner: voter.owner,
                    weight: voterWeight
                };

                for (const producer of voter.producers) {
                    if (!producerVoters.has(producer)) {
                        producerVoters.set(producer, []);
                    }
                    producerVoters.get(producer)!.push(voterEntry);
                }
            }

            // If voter is a proxy, save it with its delegators
            if (voter.is_proxy === 1) {
                try {
                    const delegators = proxyDelegators.get(voter.owner) || [];

                    // Check if FIO address is valid
                    let fioAddress = null;
                    if (voter.fioaddress && voter.fioaddress.trim() !== '') {
                        const apiUrl = await getBestApiNode(chain.toLowerCase() as 'mainnet' | 'testnet') ||
                            (chain === 'Mainnet' ? config.mainnetApiUrl : config.testnetApiUrl);

                        const isValid = await isFioAddressValid(voter.fioaddress, apiUrl);
                        if (isValid) {
                            fioAddress = voter.fioaddress;
                        } else {
                            logger_log('VOTERS', `Invalid FIO address ${voter.fioaddress} for proxy ${voter.owner}`);
                        }
                    }

                    await prisma.proxies.create({
                        data: {
                            owner: voter.owner,
                            fio_address: fioAddress,
                            chain: chain,
                            vote: voter.producers as any,
                            delegators: delegators as any
                        }
                    });
                } catch (error) {
                    logger_error('VOTERS', `Error saving proxy ${voter.owner}:`, error);
                }
            }
        }

        // Save producer voters data
        for (const [producerOwner, votersList] of producerVoters.entries()) {
            try {
                const producer = await prisma.producer.findFirst({
                    where: { owner: producerOwner, chain }
                });

                if (producer) {
                    await prisma.producerVotes.create({
                        data: {
                            producerId: producer.id,
                            voters: votersList as any
                        }
                    });
                }
            } catch (error) {
                logger_error('VOTERS', `Error saving voters for producer ${producerOwner}:`, error);
            }
        }

        logger_log('VOTERS', `Saved voting data for ${chain}. Producers: ${producerVoters.size}, Proxies: ${proxyDelegators.size}`);
    } catch (error) {
        logger_error('VOTERS', `Error processing voters for ${chain}:`, error);
    }
}