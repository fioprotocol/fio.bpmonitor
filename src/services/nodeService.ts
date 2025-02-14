import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import { config } from '../config/env';
import { getFullBaseUrl } from "../utils/helpers";
import { logger_log } from '../utils/logger';
import axios from 'axios';

// Queries db for active node data
export const getNodesQuery = async (
    chain: 'mainnet' | 'testnet' = 'mainnet',
    type: 'api' | 'seed' | 'producer' = 'api'
) => {
    const chainValue = chain === 'mainnet' ? 'Mainnet' : 'Testnet';
    let typeCondition = '';
    let orderByClause = Prisma.sql`ORDER BY n.id`;

    switch (type) {
        case 'api':
            typeCondition = 'AND n.api = true';
            orderByClause = Prisma.sql`ORDER BY s.score DESC NULLS LAST, n.id`;
            break;
        case 'seed':
        case 'producer':
            typeCondition = `AND n.type = '${type}'`;
            break;
    }

    const nodes = await prisma.$queryRaw<any[]>(Prisma.sql`
        WITH latest_scores AS (
            SELECT
                "nodeId",
                time_stamp,
                details,
                score,
                max_score,
                grade,
                ROW_NUMBER() OVER (PARTITION BY "nodeId" ORDER BY time_stamp DESC) as rn
            FROM "nodeScores"
        ),
             unique_nodes AS (
                 SELECT DISTINCT ON (n.type, n.url) n.*
        FROM "producerNodes" n
        WHERE n.status = 'active'
          AND n.chain = ${chainValue}
            ${Prisma.sql([typeCondition])}
        ORDER BY n.type, n.url, n.id
            )
        SELECT
            n.*,
            p.owner,
            p.total_votes,
            pe.candidate_name,
            pe.location_country,
            s.details AS score_details,
            s.score AS score_value,
            s.max_score AS score_max_score,
            s.grade AS score_grade,
            (
                SELECT json_agg(json_build_object('type', b.type, 'url', b.url))
                FROM "producerBranding" b
                WHERE b."producerId" = p.id
            ) AS branding
        FROM unique_nodes n
                 LEFT JOIN producer p ON n."producerId" = p.id
                 LEFT JOIN "producerExtendedData" pe ON p.id = pe."producerId"
                 LEFT JOIN latest_scores s ON n.id = s."nodeId" AND s.rn = 1
            ${orderByClause}
    `);

    return nodes.map(node => ({
        id: node.id,
        producerId: node.producerId,
        owner: node.owner,
        candidate_name: node.candidate_name,
        chain: node.chain,
        votes: node.total_votes ? Number(node.total_votes) : 0,
        location_name: node.location_name,
        location_country: node.location_country,
        location_latitude: node.location_latitude,
        location_longitude: node.location_longitude,
        type: node.type,
        url: node.url,
        api: node.api,
        historyV1: node.historyV1,
        hyperion: node.hyperion,
        server_version: node.server_version,
        status: node.status,
        score: node.score_value !== null && node.score_value !== undefined ? {
            details: node.score_details,
            score: node.score_value,
            max_score: node.score_max_score,
            grade: node.score_grade
        } : null,
        branding: (node.branding || []).reduce((acc: { [key: string]: string }, brand: any) => {
            acc[brand.type] = brand.url;
            return acc;
        }, {}),
        flagIconUrl: node.location_country
            ? `${getFullBaseUrl()}/flags/${node.location_country.toLowerCase()}.svg`
            : null
    }));
};

// Checks nodes in producerNodes
export const checkNode = async () => {
    const nodes = await prisma.producerNodes.findMany({
        where: {
            api: true,
            status: { in: ['active', 'down', 'reported'] },
        },
    });

    for (const node of nodes) {
        logger_log('NODES',`Node: ${node.id}: Starting checks for ${node.url}`);
        try {
            const response = await axios.get(`${node.url}/v1/chain/get_info`, { timeout: config.node_check_timeout });
            if (response.status === 200) {
                const data = response.data;
                const serverVersion = data.server_version_string;
                const chainId = data.chain_id;
                const headBlockDate = new Date(data.head_block_time + 'Z');
                const currentDate = new Date();
                const headBlockTime = headBlockDate.getTime();
                const currentTimeUTC = currentDate.getTime();
                const timeDifference = Math.abs(currentTimeUTC - headBlockTime);
                const cors = await checkCorsHeaders(response.headers, node.id, node.url);

                if (serverVersion) {
                    logger_log('NODES',`Node: ${node.id}: API node is running ${serverVersion}`);

                    // Check if node is more than 15 seconds off
                    if (timeDifference > 15000) {
                        logger_log('NODES',`Node: ${node.id}: Node is ${timeDifference/1000} seconds off. Block time: ${headBlockDate.toISOString()}, Current time: ${currentDate.toISOString()}, Marking as down.`);
                        await prisma.producerNodes.update({
                            where: { id: node.id },
                            data: { status: 'down' }
                        });
                        await prisma.apiNodeCheck.create({
                            data: {
                                nodeId: node.id,
                                server_version: serverVersion,
                                head_block_time: headBlockDate,
                                cors: cors,
                                status: 10010,
                            },
                        });
                        continue;
                    }

                    // Update server_version in ProducerNode
                    await prisma.producerNodes.update({
                        where: { id: node.id },
                        data: {
                            server_version: serverVersion,
                            status: 'active'
                        },
                    });

                    // Check chain_id and update ProducerNode status if it doesn't match the expected chain IDs and node.chain
                    if ((chainId === config.mainnetChainId && node.chain !== 'Mainnet') ||
                        (chainId === config.testnetChainId && node.chain !== 'Testnet') ||
                        (chainId !== config.mainnetChainId && chainId !== config.testnetChainId)) {
                        logger_log('NODES',`Node: ${node.id}: Mainnet/Testnet mismatch. Updating status...`)
                        await prisma.producerNodes.update({
                            where: { id: node.id },
                            data: { status: 'inactive' },
                        });
                        // Insert into APINodeChecks
                        await prisma.apiNodeCheck.create({
                            data: {
                                nodeId: node.id,
                                cors: cors,
                                status: 10000,
                            },
                        });
                        continue;
                    }

                    // Insert into APINodeChecks
                    await prisma.apiNodeCheck.create({
                        data: {
                            nodeId: node.id,
                            server_version: serverVersion,
                            head_block_time: headBlockDate,
                            cors: cors,
                            status: response.status,
                        },
                    });

                    // Perform fetch check
                    await checkNodeFetch(node.id, node.url);

                    // Perform burst check
                    await checkBurstFetch(node.id, node.url);
                } else {
                    logger_log('NODES',`Node: ${node.id}: API node response received, but server version not found.`);
                    await prisma.apiNodeCheck.create({
                        data: {
                            nodeId: node.id,
                            server_version: '',
                            cors: cors,
                            status: 0,
                        },
                    });
                    await updateNodeStatus(node.id);
                }
            } else {
                // Handle non-200 response
                logger_log('NODES',`Node: ${node.id}: API node is not running. Status code: ${response.status}`);
                await prisma.apiNodeCheck.create({
                    data: {
                        nodeId: node.id,
                        server_version: '',
                        cors: false,
                        status: response.status,
                    },
                });
                await updateNodeStatus(node.id);
            }

        } catch (error: any) {
            // Unable to connect or other issues (timeout, DNS issues, etc.)
            logger_log('NODES',`Node: ${node.id}: API node is not running. Generic error.`);
            await prisma.apiNodeCheck.create({
                data: {
                    nodeId: node.id,
                    server_version: '',
                    cors: false,
                    status: 0,
                },
            });
            await updateNodeStatus(node.id);
        }

        // Check V1 History
        try {
            const historyResponse = await axios.post(`${node.url}/v1/history/get_actions`, {
                account_name: 'tw4tjkmo4eyd'
            }, { timeout: config.node_check_timeout });

            if (historyResponse.status === 200 && historyResponse.data.last_irreversible_block) {
                logger_log('NODES',`Node: ${node.id}: V1 History is running.`)
                await prisma.producerNodes.update({
                    where: { id: node.id },
                    data: { historyV1: true },
                });
            } else {
                logger_log('NODES',`Node: ${node.id}: V1 History is not running.`)
                await prisma.producerNodes.update({
                    where: { id: node.id },
                    data: { historyV1: false },
                });
            }
        } catch (historyError: any) {
            logger_log('NODES',`Node: ${node.id}: V1 History is not running.`)
            await prisma.producerNodes.update({
                where: { id: node.id },
                data: { historyV1: false },
            });
        }

        // Check Hyperion
        try {
            const healthResponse = await axios.get(`${node.url}/v2/health`, { timeout: config.node_check_timeout });

            if (healthResponse.status === 200) {
                const healthData = healthResponse.data;
                const nodeosRPC = healthData.health.find((service: { service: string }) => service.service === 'NodeosRPC');

                if (nodeosRPC && nodeosRPC.status === 'OK' && Math.abs(nodeosRPC.service_data?.time_offset || Infinity) <= 1800000) {
                    logger_log('NODES',`Node: ${node.id}: Hyperion is running.`)
                    await prisma.producerNodes.update({
                        where: { id: node.id },
                        data: { hyperion: true },
                    });
                } else {
                    logger_log('NODES',`Node: ${node.id}: Hyperion is not running.`)
                    await prisma.producerNodes.update({
                        where: { id: node.id },
                        data: { hyperion: false },
                    });
                }
            } else {
                logger_log('NODES',`Node: ${node.id}: Hyperion is not running.`)
                await prisma.producerNodes.update({
                    where: { id: node.id },
                    data: { hyperion: false },
                });
            }
        } catch (healthError: any) {
            logger_log('NODES',`Node: ${node.id}: Hyperion is not running.`)
            await prisma.producerNodes.update({
                where: { id: node.id },
                data: { hyperion: false },
            });
        }
    }
    logger_log('NODES',`Node checks complete.`)
};

// Updates node status in producerNodes
async function updateNodeStatus(nodeId: number) {
    const recentChecks = await prisma.apiNodeCheck.findMany({
        where: { nodeId },
        orderBy: { time_stamp: 'desc' },
        take: 3
    });

    if (recentChecks.length < 3 || recentChecks.every(check => !check.server_version)) {
        await prisma.producerNodes.update({
            where: { id: nodeId },
            data: { status: 'down' }
        });
    }
}

// Checks node for number of results returned
async function checkNodeFetch(nodeId: number, url: string) {
    try {
        const response = await axios.post(`${url}/v1/chain/get_table_rows`, {
            json: true,
            code: "fio.address",
            scope: "fio.address",
            table: "fionames"
        });

        if (response.status === 200 && response.data && Array.isArray(response.data.rows)) {
            const resultsCount = response.data.rows.length;
            await prisma.apiFetchCheck.create({
                data: {
                    nodeId,
                    results: resultsCount
                }
            });
            logger_log('NODES', `Node: ${nodeId}: Fetch check successful. Results: ${resultsCount}`);
        } else {
            await prisma.apiFetchCheck.create({
                data: {
                    nodeId,
                    results: 0
                }
            });
            logger_log('NODES', `Node: ${nodeId}: Fetch check failed. Malformed response.`);
        }
    } catch (error: unknown) {
        await prisma.apiFetchCheck.create({
            data: {
                nodeId,
                results: 0
            }
        });
        if (error instanceof Error) {
            logger_log('NODES', `Node: ${nodeId}: Fetch check failed. Error: ${error.message}`);
        } else {
            logger_log('NODES', `Node: ${nodeId}: Fetch check failed. Unknown error occurred.`);
        }
    }
}

// Checks node for ability to accept burst of API calls
async function checkBurstFetch(nodeId: number, url: string) {
    try {
        const burstTarget = config.node_burst_check_count;
        const pubKey = config.node_burst_check_pub_key;
        const requestBody = {
            fio_public_key: pubKey
        };

        // Create array of promises for concurrent requests
        const requests = Array(burstTarget).fill(null).map(() =>
            axios.post(`${url}/v1/chain/get_fio_balance`, requestBody, {
                timeout: config.node_check_timeout
            })
                .then(response => {
                    // Check if response has valid format
                    if (response.status === 200 &&
                        response.data &&
                        typeof response.data.balance === 'number' &&
                        typeof response.data.available === 'number' &&
                        typeof response.data.staked === 'number' &&
                        typeof response.data.srps === 'number' &&
                        typeof response.data.roe === 'string') {
                        return true;
                    }
                    return false;
                })
                .catch(() => false) // Any error (including 429) counts as failed request
        );

        // Execute all requests concurrently
        const results = await Promise.all(requests);
        const successCount = results.filter(result => result).length;

        // Store results
        await prisma.apiBurstCheck.create({
            data: {
                nodeId,
                status: successCount === burstTarget,
                burstTarget,
                burstResult: successCount
            }
        });

        logger_log('NODES', `Node: ${nodeId}: Burst check completed. Successful responses: ${successCount}/${burstTarget}`);
    } catch (error: unknown) {
        await prisma.apiBurstCheck.create({
            data: {
                nodeId,
                status: false,
                burstTarget: config.node_burst_check_count,
                burstResult: 0
            }
        });
        if (error instanceof Error) {
            logger_log('NODES', `Node: ${nodeId}: Burst check catastrophically failed. Error: ${error.message}`);
        } else {
            logger_log('NODES', `Node: ${nodeId}: Burst check catastrophically failed. Unknown error occurred.`);
        }
    }
}

// Check CORS headers from both GET and OPTIONS requests
async function checkCorsHeaders(headers: any, nodeId: number, baseUrl: string): Promise<boolean> {
    try {
        // Check GET headers from the initial request
        const getOrigin = headers['access-control-allow-origin'];
        const getEnabled = getOrigin === '*';

        // Test both GET and POST endpoints with OPTIONS preflight
        const [optionsGetResponse, optionsPostResponse] = await Promise.all([
            axios.options(`${baseUrl}/v1/chain/get_info`, {
                headers: {
                    'Origin': 'http://test.com',
                    'Access-Control-Request-Method': 'GET',
                    'Access-Control-Request-Headers': 'content-type'
                }
            }),
            axios.options(`${baseUrl}/v1/chain/get_fio_balance`, {
                headers: {
                    'Origin': 'http://test.com',
                    'Access-Control-Request-Method': 'POST',
                    'Access-Control-Request-Headers': 'content-type,accept'
                }
            })
        ]);

        // Check CORS headers for both responses
        const getOptionsOrigin = optionsGetResponse.headers['access-control-allow-origin'];
        const postOptionsOrigin = optionsPostResponse.headers['access-control-allow-origin'];
        const getOptionsAllowHeaders = optionsGetResponse.headers['access-control-allow-headers'];
        const postOptionsAllowHeaders = optionsPostResponse.headers['access-control-allow-headers'];

        // Check if content-type is allowed in headers for both methods
        const contentTypeAllowed = (header: string | undefined): boolean =>
            header?.toLowerCase().split(',').some((h: string): boolean =>
                h.trim() === 'content-type' || h.trim() === '*'
            ) || false;

        const getEnabled_Options = getOptionsOrigin === '*' && contentTypeAllowed(getOptionsAllowHeaders);
        const postEnabled_Options = postOptionsOrigin === '*' && contentTypeAllowed(postOptionsAllowHeaders);
        const optionsEnabled = getEnabled_Options && postEnabled_Options;

        const corsEnabled = getEnabled && optionsEnabled;

        logger_log('NODES', `Node: ${nodeId}: CORS check completed: ${corsEnabled} (GET: ${getEnabled}, OPTIONS-GET: ${getEnabled_Options}, OPTIONS-POST: ${postEnabled_Options})`);
        return corsEnabled;
    } catch (error) {
        logger_log('NODES', `Node: ${nodeId}: CORS check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
    }
}